import { applyJobActionPermissions } from './job-action-permission-policy';

describe('versioned job access configuration', () => {
  it('adds narrow grants once and never restores a subsequently removed permission', async () => {
    let complete = false;
    const roles = [
      { id: 'recruiter', tenant_id: 'tenant', permissions: ['job:view', 'candidate:view', 'submission:create'] },
      { id: 'manager', tenant_id: 'tenant', permissions: ['job:view', 'candidate:view', 'job:edit'] },
      { id: 'delivery', tenant_id: 'tenant', permissions: ['unit_admin:manage'] },
    ];
    const tx = {
      auditLog: {
        findFirst: jest.fn(async ({ where }) => where.action === 'JOB_OWN_ACTIONS_V1_COMPLETE' || complete ? { id: 'done' } : null),
        create: jest.fn(async ({ data }) => { if (data.action === 'JOB_ACCESS_V2_COMPLETE') complete = true; }),
      },
      $queryRawUnsafe: jest.fn(async () => roles),
      $executeRawUnsafe: jest.fn(async (sql: string, json?: string, id?: string) => {
        if (sql.startsWith('UPDATE')) roles.find(role => role.id === id)!.permissions = JSON.parse(json!);
      }),
    };
    const db: any = { $transaction: (run: any) => run(tx) };
    await applyJobActionPermissions(db);
    expect(roles[0].permissions).toContain('job:find_matches_assigned');
    expect(roles[0].permissions).not.toContain('job:edit');
    expect(roles[1].permissions.some(key => key.startsWith('job:manage_publication'))).toBe(false);
    expect(roles[2].permissions).toContain('job:manage_publication_unit');
    roles[0].permissions = ['job:view', 'candidate:view', 'submission:create'];
    const writes = tx.$executeRawUnsafe.mock.calls.filter(([sql]) => sql.startsWith('UPDATE')).length;
    await applyJobActionPermissions(db);
    expect(roles[0].permissions).not.toContain('job:find_matches_assigned');
    expect(tx.$executeRawUnsafe.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'))).toHaveLength(writes);
  });
});
