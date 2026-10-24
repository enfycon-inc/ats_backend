import { AuthUserService } from './auth-user.service';

describe('saved tenant branding on profile reload', () => {
  it('returns the authenticated tenant logo and title', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{
      id: 'member', tenant_id: 'workspace', tenant_name: 'Example',
      site_title: 'Example recruitment', logo_url: 'site-logo', login_logo_url: 'login-logo',
    }] });
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    const profile = await service.getProfile('member');
    expect(profile.tenant).toEqual(expect.objectContaining({
      siteTitle: 'Example recruitment', logoUrl: 'site-logo', loginLogoUrl: 'login-logo',
    }));
    expect(query.mock.calls[0][0]).toContain('t.site_title, t.logo_url');
    expect(query.mock.calls[0][1]).toEqual(['member']);
  });
});

import { AuthTenantService } from './auth-tenant.service';
describe('login logo policy', () => {
  it.each([{ settings: [] }, { settings: [{ tenant_id: 'workspace' }] }])('uses the separate login logo with or without saved auth settings (%j)', async ({ settings }) => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ name: 'Example', logo_url: 'site', login_logo_url: 'login' }] })
      .mockResolvedValueOnce({ rows: settings });
    const service = new AuthTenantService({ query } as any, {} as any, {} as any);
    expect(await service.getTenantAuthPolicy('737f666b-916a-4e9c-91bd-b2bd37e475d1')).toEqual(expect.objectContaining({ logoUrl: 'site', loginLogoUrl: 'login' }));
  });
});
