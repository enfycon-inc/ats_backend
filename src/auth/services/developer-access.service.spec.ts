import { DeveloperAccessService } from './developer-access.service';
import { AuthKeycloakService } from './auth-keycloak.service';
import { AuthCoreService } from './auth-core.service';
import { AuthTenantService } from './auth-tenant.service';

describe('restricted developer sign-in', () => {
  const grant = { id: 'user', tenant_id: 'tenant', grant_id: 'grant' };
  function setup(rows: any[] = []) {
    const query = jest.fn().mockResolvedValue({ rows });
    return { query, service: new DeveloperAccessService({ query } as any) };
  }
  it.each([undefined, '', 'workspace/path', 'workspace:3000', 'workspace%00'])('requires an explicit exact workspace: %s', async workspace => {
    const { service, query } = setup([grant]);
    await expect(service.authorize('dev@example.test', workspace)).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
  });
  it('requires a single active tenant, account, policy, and individual grant', async () => {
    const { service, query } = setup([grant]);
    await expect(service.authorize(' DEV@example.test ', 'Workspace')).resolves.toEqual(grant);
    expect(query.mock.calls[0][1]).toEqual(['dev@example.test', 'workspace']);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('p.allow_developer_login');
    expect(sql).toContain('u.is_active AND u.is_approved');
    expect(sql).toContain('g.tenant_id = u.tenant_id');
    expect(sql).not.toContain('startsWith');
  });
  it.each([{rows:[]}, {rows:[grant, grant]}])('fails closed for absent or ambiguous eligibility', async ({rows}) => {
    await expect(setup(rows).service.authorize('dev@example.test', 'workspace')).rejects.toMatchObject({ status: 401 });
  });
  it('does not accept a non-boolean grant', async () => {
    await expect(setup().service.setGrant('tenant','user','actor','true' as any)).rejects.toMatchObject({ status: 400 });
  });
  it('does not grant access to an account outside the tenant', async () => {
    const { service, query } = setup();
    await expect(service.setGrant('tenant','other-user','actor',true)).rejects.toMatchObject({ status: 400 });
    expect(query.mock.calls[0][0]).toContain('WHERE tenant_id=$1::uuid AND id=$2::uuid');
  });
  it('rechecks policy and grant under locks before returning credentials', async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn() };
    const service = new DeveloperAccessService({ prisma: { $transaction: cb => cb(tx) } } as any);
    await expect(service.registerSession(grant, { sub:'identity',sid:'session' })).rejects.toMatchObject({ status: 401 });
    expect(tx.$queryRawUnsafe.mock.calls[0][0]).toContain('FOR SHARE OF g, p');
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('persists the policy generation and identity-provider session', async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ developer_login_epoch:'epoch' }]), $executeRawUnsafe: jest.fn() };
    const service = new DeveloperAccessService({ prisma: { $transaction: cb => cb(tx) } } as any);
    await service.registerSession(grant, { sub:'identity',sid:'session' });
    expect(tx.$executeRawUnsafe.mock.calls[0].slice(1)).toEqual(['identity','session','grant','tenant','epoch']);
  });
  it('never treats a body property as authorization to bypass normal password policy', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows:[{ ...grant, is_active:true,is_approved:true,tenant_status:'ACTIVE' }] }) };
    const core = new AuthCoreService(db as any, null as any, { getTenantAuthPolicy: async () => ({allowPasswordLogin:false}) } as any, null as any, null as any);
    await expect(core.login({ email:'dev@example.test',password:'secret',developer:true } as any)).rejects.toMatchObject({ status:401 });
  });
  it('binds password authentication to the granted membership when email exists in multiple tenants', async () => {
    const db = { query: jest.fn().mockResolvedValue({rows:[{id:'different-user',tenant_id:'other-tenant'}]}) };
    const developer = { authorize: jest.fn().mockResolvedValue(grant) };
    const core = new AuthCoreService(db as any, null as any, null as any, null as any, null as any, developer as any);
    await expect(core.login({email:'dev@example.test',password:'secret',subdomain:'workspace'},true)).rejects.toMatchObject({status:401});
    expect(db.query.mock.calls[0][1]).toEqual(['dev@example.test','user','tenant']);
  });
  it('never enters account bootstrap when developer eligibility fails', async () => {
    const db = {query:jest.fn()};
    const developer = {authorize:jest.fn().mockRejectedValue(new Error('not authorized'))};
    const core = new AuthCoreService(db as any, null as any, null as any, null as any, null as any, developer as any);
    await expect(core.login({email:'dev@example.test',password:'secret',subdomain:'workspace'},true)).rejects.toThrow('not authorized');
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('developer session enforcement', () => {
  it.each([false, null])('rejects deleted grants, disabled policies, or mismatched generations: %s', async allowed => {
    const query = jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{allowed}]});
    await expect(new AuthKeycloakService({query} as any).assertSessionActive({ sub:'identity',sid:'session' })).rejects.toMatchObject({status:401});
    expect(query.mock.calls[1][0]).toContain('s.policy_epoch=p.developer_login_epoch');
  });
  it.each([{rows:[], expected:undefined}, {rows:[{allowed:true,tenant_id:'tenant',user_id:'user'}], expected:{tenantId:'tenant',userId:'user'}}])('preserves normal and authorized developer sessions', async ({rows,expected}) => {
    const query = jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows});
    await expect(new AuthKeycloakService({query} as any).assertSessionActive({sub:'identity',session_state:'session'})).resolves.toEqual(expected);
  });
});

describe('authentication policy validation', () => {
  it.each([{ allowDeveloperLogin:'true' }, {allowDeveloperLogin:true, allowPasswordLogin:false, allowMicrosoftSso:false,allowGoogleSso:false}, {enforceSsoOnly:true,allowMicrosoftSso:false,allowGoogleSso:false}])('rejects unsafe policy before persisting: %j', async dto => {
    const query = jest.fn();
    const service = new AuthTenantService({query} as any, null as any, null as any, null as any);
    jest.spyOn(service,'getTenantAuthPolicy').mockResolvedValue({allowPasswordLogin:true} as any);
    await expect(service.updateTenantAuthPolicy('tenant',dto as any)).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();
  });
  it('can disable developer access without contacting a failing identity provider', async () => {
    const saved = {tenant_id:'tenant',allow_developer_login:false,allow_microsoft_sso:true};
    const query = jest.fn().mockResolvedValue({rows:[saved]});
    const keycloak = {configureTenantIdentityProvider:jest.fn().mockRejectedValue(new Error('offline'))};
    const service = new AuthTenantService({query} as any,null as any,keycloak as any,null as any);
    jest.spyOn(service,'getTenantAuthPolicy').mockResolvedValue({allowPasswordLogin:false,allowMicrosoftSso:true,allowDeveloperLogin:true,microsoftClientId:'client',microsoftTenantId:'11111111-1111-4111-8111-111111111111'} as any);
    await expect(service.updateTenantAuthPolicy('tenant',{allowDeveloperLogin:false})).resolves.toMatchObject({allowDeveloperLogin:false});
    expect(keycloak.configureTenantIdentityProvider).not.toHaveBeenCalled();
    expect(query.mock.calls[1][0]).toContain('developer_login_epoch = CASE WHEN NOT EXCLUDED.allow_developer_login');
  });

});
