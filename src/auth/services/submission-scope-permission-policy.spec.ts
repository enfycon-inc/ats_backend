import { applySubmissionScopePermissions } from './submission-scope-permission-policy';
describe('submission scope default configuration', () => {
  it('adds defaults once and preserves subsequent explicit removals', async () => {
    let completed = false;
    const tx: any = {
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'am', tenant_id: null, system_key: 'ACCOUNT_MANAGER', permissions: ['submission:create'] }, { id: 'dh', tenant_id: null, system_key: 'DELIVERY_HEAD', permissions: ['submission:create'] }, { id: 'no-submit', tenant_id: null, system_key: 'ACCOUNT_MANAGER', permissions: [] }]),
      auditLog: { findFirst: jest.fn(async () => completed ? { id: 'marker' } : null), create: jest.fn(async ({ data }) => { if (data.action === 'SUBMISSION_SCOPE_V1_COMPLETE') completed = true; }) },
    };
    const db: any = { $transaction: async (fn: any) => fn(tx) };
    await applySubmissionScopePermissions(db);
    const updates = tx.$executeRawUnsafe.mock.calls.filter((args: any[]) => args[0].startsWith('UPDATE'));
    expect(updates).toHaveLength(4);
    expect(updates[0][1]).toContain('job:submit_owned_jobs');
    expect(updates[1][1]).toContain('job:submit_unit_jobs');
    expect(tx.$queryRawUnsafe.mock.calls[1][0]).toContain('cr.is_system = true');
    await applySubmissionScopePermissions(db);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
});
