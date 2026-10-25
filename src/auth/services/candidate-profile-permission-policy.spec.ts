import { applyCandidateProfilePermissions } from './candidate-profile-permission-policy';

it('grants profile administration once, with audit history, preserving later revocation', async () => {
  let complete = false;
  const roles = [{ id: 'delivery', tenant_id: 'tenant', permissions: ['unit_admin:manage'] }, { id: 'recruiter', tenant_id: 'tenant', permissions: ['candidate:create'] }];
  const tx: any = { auditLog: { findFirst: jest.fn(async () => complete ? { id: 'complete' } : null), create: jest.fn(async ({ data }) => { if (data.action === 'CANDIDATE_PROFILE_V1_COMPLETE') complete = true; }) }, $queryRawUnsafe: jest.fn().mockResolvedValue(roles), $executeRawUnsafe: jest.fn(async (sql, json, id) => { if (sql.startsWith('UPDATE')) roles.find(role => role.id === id)!.permissions = JSON.parse(json); }) };
  const db: any = { $transaction: async fn => fn(tx) };
  await applyCandidateProfilePermissions(db);
  expect(roles[0].permissions).toContain('candidate:change_market');
  expect(roles[1].permissions).toEqual(['candidate:create']);
  expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'CANDIDATE_PROFILE_V1', details: expect.objectContaining({ before: ['unit_admin:manage'] }) }) }));
  roles[0].permissions = ['unit_admin:manage'];
  await applyCandidateProfilePermissions(db);
  expect(roles[0].permissions).toEqual(['unit_admin:manage']);
});
