import { recruiterDashboard } from './recruiter-dashboard';

describe('personal recruiter dashboard', () => {
  const actor: any = {
    dbId: 'recruiter',
    tenantId: 'tenant',
    permissions: [
      'job:view',
      'candidate:view',
      'submission:view',
      'submission:create',
      'job:find_matches_assigned',
    ],
  };
  function setup() {
    const db: any = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            branchId: 'branch',
            businessUnitId: 'unit',
            podId: 'pod',
          }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: false }),
      },
      businessUnit: { findFirst: jest.fn() },
      $queryRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
        const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) =>
          Number(m[1]),
        );
        expect(Math.max(...placeholders)).toBe(args.length);
        expect(args.slice(0, 4)).toEqual([
          'tenant',
          'recruiter',
          'branch',
          'unit',
        ]);
        expect(sql).toMatch(/[js]\.tenant_id = \$1::uuid/);
        expect(sql).toContain('j.branch_id = $3::uuid');
        expect(sql).toContain('j.business_unit_id = $4::uuid');
        expect(sql).not.toContain('SELECT *');
        if (sql.includes('AS pending'))
          return [{ active: 12, pending: 8, total: 18 }];
        if (sql.startsWith('WITH'))
          return [
            {
              id: 'job',
              job_title: 'Data Engineer',
              job_code: 'IN-001',
              job_type: 'Full-time',
              market: 'INDIA',
              urgency: 'WARM',
              assigned_at: new Date(),
              status: 'ACTIVE',
              approval_status: 'APPROVED',
              submission_done: 1,
              submission_required: 2,
              directly_assigned: true,
            },
          ];
        if (sql.startsWith('SELECT s.final_status'))
          return [
            { final_status: 'PENDING_APPROVAL', count: 8, interviewing: 0 },
            { final_status: 'SUBMITTED', count: 7, interviewing: 5 },
            { final_status: 'SELECTED', count: 3, interviewing: 0 },
            { final_status: 'REJECTED', count: 4, interviewing: 0 },
          ];
        if (sql.startsWith('SELECT r.status'))
          return [
            { status: 'CLEARED', count: 4 },
            { status: 'CANCELLED', count: 1 },
          ];
        return [
          {
            submission_id: 'submission',
            full_name: 'Candidate',
            job_title: 'Data Engineer',
            round: 'L1',
            status: 'SCHEDULED',
            date: '2026-10-30T12:00:00Z',
            interviewer: 'Reviewer',
            job_timezone: 'Asia/Kolkata',
            meeting_link: 'https://example.test/meeting',
          },
        ];
      }),
    };
    return db;
  }
  it('uses full aggregates, separate current stages, independent upcoming queries and explicit permissions', async () => {
    const db = setup();
    const data = await recruiterDashboard(db, actor, 'tenant', '2026-10', 30);
    expect(data.pendingJobs).toBe(8);
    expect(data.totalActiveJobs).toBe(12);
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0]).toMatchObject({
      canSubmit: true,
      canMatch: true,
      jobType: 'Full-time',
      market: 'INDIA',
    });
    expect(data.metrics).toEqual({
      jobs: 18,
      submissions: 22,
      selected: 3,
      rejected: 4,
      interviews: 5,
    });
    expect(data.submissionStages.reduce((n, r) => n + r.count, 0)).toBe(22);
    expect(
      data.submissionStages.find((r) => r.label === 'In progress')?.count,
    ).toBe(2);
    expect(data.interviewOutcomes).toContainEqual({
      label: 'CANCELLED',
      count: 1,
    });
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(6);
    const sql = db.$queryRawUnsafe.mock.calls.map((args: any[]) => args[0]);
    expect(sql[0]).toContain('ORDER BY assigned_at DESC, id LIMIT 4');
    expect(sql[5]).toContain('r.date >= CURRENT_TIMESTAMP');
    expect(sql[5]).not.toContain('$5');
  });
  it('reads current membership and disables pod assignments when tenant pods are off', async () => {
    const db = setup();
    await recruiterDashboard(
      db,
      {
        ...actor,
        branchId: 'stale',
        permissions: [...actor.permissions, 'job:submit_pod_jobs'],
      },
      'tenant',
      '2026-10',
      0,
    );
    expect(db.$queryRawUnsafe.mock.calls[0][5]).toBe(false);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
  });
  it('does not query submissions or interviews without submission access', async () => {
    const db = setup();
    const data = await recruiterDashboard(
      db,
      { ...actor, permissions: ['job:view'] },
      'tenant',
      '2026-10',
      7,
    );
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(data.calendar).toEqual([]);
    expect(data.metrics.submissions).toBe(0);
    expect(data.jobs[0]).toMatchObject({ canSubmit: false, canMatch: false });
  });
  it('does not query job assignments without job visibility', async () => {
    const db = setup();
    const data = await recruiterDashboard(
      db,
      { ...actor, permissions: ['submission:view'] },
      'tenant',
      '2026-10',
      90,
    );
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(4);
    expect(data.jobs).toEqual([]);
  });
  it.each([
    ['other', '2026-10', 30],
    ['tenant', 'bad', 30],
    ['tenant', '2026-13', 30],
    ['tenant', '2026-10', 31],
  ])(
    'rejects invalid scopes or filters before queries',
    async (tenant, month, range) => {
      const db = setup();
      await expect(
        recruiterDashboard(db, actor, tenant, month, range),
      ).rejects.toThrow();
      expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    },
  );
  it('fails closed when current membership has no unit', async () => {
    const db = setup();
    db.user.findFirst.mockResolvedValue({ branchId: 'branch' });
    await expect(
      recruiterDashboard(db, actor, 'tenant', '2026-10', 30),
    ).rejects.toThrow('current branch and unit');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
