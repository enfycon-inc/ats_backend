import { geofenceResult, OfficeLocationService } from './office-location.service';
describe('Office location evidence', () => {
  const fence = { latitude: 12, longitude: 77, radius_metres: 150 };
  it('distinguishes inside, outside and overlapping accuracy estimates', () => {
    expect(geofenceResult(12, 77, 20, fence)).toBe('within');
    expect(geofenceResult(12, 77, 300, fence)).toBe('uncertain');
    expect(geofenceResult(13, 77, 20, fence)).toBe('outside');
  });
  it('does not require or expose geofence settings when optional collection is disabled', async () => {
    const old = process.env.USER_OFFICE_EVIDENCE_ENABLED;
    delete process.env.USER_OFFICE_EVIDENCE_ENABLED;
    try {
      const db: any = { $queryRawUnsafe: jest.fn() };
      await expect(new OfficeLocationService(db, {} as any).context({ branchId: 'branch' } as any)).resolves.toEqual({ enabled: false, configured: false });
      expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    } finally { if (old !== undefined) process.env.USER_OFFICE_EVIDENCE_ENABLED = old; }
  });
  it('requires a network management capability before exposing branch settings', async () => {
    const db: any = { $queryRawUnsafe: jest.fn() };
    await expect(new OfficeLocationService(db, {} as any).branches({ permissions: ['user:manage'], tenantId: 'tenant' } as any)).rejects.toThrow();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('restricts branch settings lookup to all explicitly assigned branches', async () => {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    await new OfficeLocationService(db, {} as any).branches({
      tenantId: 'tenant', branchId: 'branch-a', assignedBranchIds: ['branch-b'], permissions: ['branch:network:manage'],
    } as any);
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('id=ANY($2::uuid[])');
    expect(db.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['tenant', ['branch-b', 'branch-a']]);
  });
  it('limits a unit administrator to their assigned unit geofence', async () => {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'unit-a', name: 'Unit A', branchId: 'branch-a', branchName: 'Branch A' }]) };
    const units = await new OfficeLocationService(db, {} as any).geofenceUnits({
      tenantId: 'tenant', businessUnitId: 'unit-a', branchId: 'branch-a', permissions: ['unit_admin:manage', 'unit:geofence:manage'],
    } as any);
    expect(units).toHaveLength(1);
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('bu.id=$2::uuid');
    expect(db.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['tenant', 'unit-a']);
  });
  it('does not allow branch network permission alone to manage unit geofences', async () => {
    const db: any = { $queryRawUnsafe: jest.fn() };
    await expect(new OfficeLocationService(db, {} as any).geofenceUnits({ tenantId: 'tenant', permissions: ['branch:network:manage'] } as any)).rejects.toThrow();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('reads employee geofence context from the assigned business unit', async () => {
    const oldTelemetry = process.env.USER_MANAGEMENT_TELEMETRY_ENABLED;
    const oldOffice = process.env.USER_OFFICE_EVIDENCE_ENABLED;
    process.env.USER_MANAGEMENT_TELEMETRY_ENABLED = 'true'; process.env.USER_OFFICE_EVIDENCE_ENABLED = 'true';
    try {
      const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
      await expect(new OfficeLocationService(db, {} as any).context({ tenantId: 'tenant', businessUnitId: 'unit-a' } as any)).resolves.toEqual({ enabled: true, configured: true });
      expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('business_unit_id=$2::uuid');
      expect(db.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['tenant', 'unit-a']);
    } finally {
      if (oldTelemetry === undefined) delete process.env.USER_MANAGEMENT_TELEMETRY_ENABLED; else process.env.USER_MANAGEMENT_TELEMETRY_ENABLED = oldTelemetry;
      if (oldOffice === undefined) delete process.env.USER_OFFICE_EVIDENCE_ENABLED; else process.env.USER_OFFICE_EVIDENCE_ENABLED = oldOffice;
    }
  });
  it('rejects stale or forged coordinate shapes before using a challenge', async () => {
    const old = process.env.USER_OFFICE_EVIDENCE_ENABLED;
    const telemetryOld = process.env.USER_MANAGEMENT_TELEMETRY_ENABLED;
    process.env.USER_OFFICE_EVIDENCE_ENABLED = 'true';
    process.env.USER_MANAGEMENT_TELEMETRY_ENABLED = 'true';
    try {
      const service = new OfficeLocationService({} as any, {} as any);
      await expect(service.check({ branchId: 'branch', businessUnitId: 'unit' } as any, { challenge: 'bad', latitude: 100 })).rejects.toThrow('fresh location');
    } finally {
      if (old === undefined) delete process.env.USER_OFFICE_EVIDENCE_ENABLED; else process.env.USER_OFFICE_EVIDENCE_ENABLED = old;
      if (telemetryOld === undefined) delete process.env.USER_MANAGEMENT_TELEMETRY_ENABLED; else process.env.USER_MANAGEMENT_TELEMETRY_ENABLED = telemetryOld;
    }
  });
});
