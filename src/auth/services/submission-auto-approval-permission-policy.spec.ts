import { applySubmissionAutoApprovalPermissions } from './submission-auto-approval-permission-policy';
import { SUBMISSION_AUTO_APPROVAL_PERMISSION as AUTO } from '../../recruiter-submissions/submission-auto-approval';

describe('automatic internal review default grants', () => {
  it('updates eligible bundles once, audits grants, and preserves later opt-outs', async () => {
    let complete = false;
    const keys = ['ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'BRANCH_ADMIN', 'UNIT_ADMIN', 'TENANT_ADMIN', 'RECRUITER', 'POD_LEAD'];
    const system = keys.map(system_key => ({ id: system_key, tenant_id: null, system_key, permissions: ['submission:view'] }));
    const custom = keys.map(system_key => ({ id: `custom-${system_key}`, tenant_id: 'tenant-a', system_key, permissions: ['submission:view'] }));
    const roles = [...system, ...custom];
    const tx = {
      auditLog: { findFirst: jest.fn(async () => complete ? { id: 'complete' } : null), create: jest.fn(async ({ data }) => { if (data.action.endsWith('_COMPLETE')) complete = true; }) },
      $queryRawUnsafe: jest.fn(async (sql: string) => sql.includes('WITH RECURSIVE') ? custom : system),
      $executeRawUnsafe: jest.fn(async (sql: string, json?: string, id?: string) => {
        if (sql.startsWith('UPDATE')) roles.find(role => role.id === id)!.permissions = JSON.parse(json!);
      }),
    };
    const db: any = { $transaction: (run: any) => run(tx) };
    await applySubmissionAutoApprovalPermissions(db);
    for (const role of roles) expect(role.permissions.includes(AUTO)).toBe(!['RECRUITER', 'POD_LEAD'].includes(role.system_key));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(11);
    expect(tx.$queryRawUnsafe.mock.calls[1][0]).toContain('cr.tenant_id = parent.tenant_id');
    custom[0].permissions = ['submission:view'];
    const writes = tx.$executeRawUnsafe.mock.calls.filter(([sql]) => sql.startsWith('UPDATE')).length;
    await applySubmissionAutoApprovalPermissions(db);
    expect(custom[0].permissions).not.toContain(AUTO);
    expect(tx.$executeRawUnsafe.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'))).toHaveLength(writes);
  });
});
