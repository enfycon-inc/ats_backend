import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

describe('Delivery Head submission boundaries', () => {
  const actor = { dbId: 'actor', tenantId: 'tenant', permissions: ['unit_admin:manage', 'submission:view', 'submission:internal_screening', 'job:view_all_branches'] } as AuthUser;
  it('applies fresh unit and branch predicates to the tracker and its counts', async () => {
    const db: any = { user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch', businessUnitId: 'unit' }) }, $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]) };
    const service = new RecruiterSubmissionsService(db, {} as any);
    await service.findAll('tenant', actor, {});
    for (const [sql, ...params] of db.$queryRawUnsafe.mock.calls) {
      expect(sql).toContain('j.tenant_id = $1 AND j.branch_id = $2::uuid AND j.business_unit_id = $3::uuid');
      expect(params.slice(0, 3)).toEqual(['tenant', 'branch', 'unit']);
    }
  });
  it('refuses all tracker access when membership is missing', async () => {
    const db: any = { user: { findFirst: jest.fn().mockResolvedValue(null) }, $queryRawUnsafe: jest.fn() };
    await expect(new RecruiterSubmissionsService(db, {} as any).findAll('tenant', actor, {})).rejects.toThrow('assignment');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
