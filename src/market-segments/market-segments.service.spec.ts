import { MarketSegmentsService } from './market-segments.service';
import { MarketSegmentsController } from './market-segments.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';

describe('Platform market catalog', () => {
  const makeService = (existing: any[] = []) => {
    const rows = [...existing];
    const marketSegment = {
      findFirst: jest.fn(async ({ where }) => rows.find(r => r.code === where.code && r.tenantId === where.tenantId)),
      create: jest.fn(async ({ data }) => { rows.push(data); return data; }),
      findMany: jest.fn(async ({ where }) => rows.filter(r => r.tenantId === null && (where.isActive === undefined || r.isActive === where.isActive))),
    };
    const tx = { marketSegment, $queryRaw: jest.fn().mockResolvedValue([]) };
    const prisma = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
    return { service: new MarketSegmentsService(prisma as any), rows, marketSegment, tx };
  };

  it('initializes an empty catalog with the requested global codes and regional defaults', async () => {
    const { service, rows, tx } = makeService();
    await service.onModuleInit();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(rows.map(r => [r.code, r.defaultCurrency, r.defaultTimezone])).toEqual([
      ['IND', 'INR', 'Asia/Kolkata'], ['USIT', 'USD', 'America/New_York'], ['UAE', 'AED', 'Asia/Dubai'],
    ]);
    expect(rows.every(r => r.tenantId === null && r.isActive)).toBe(true);
    await service.onModuleInit();
    expect(rows).toHaveLength(3);
  });

  it('preserves disabled markets and excludes tenant-specific records from the platform catalog', async () => {
    const disabled = { tenantId: null, code: 'IND', isActive: false };
    const { service, rows } = makeService([disabled, { tenantId: 'tenant', code: 'UAE', isActive: true }]);
    await service.onModuleInit();
    expect(rows[0]).toEqual(disabled);
    expect((await service.findAll()).map(r => r.code)).toEqual(['USIT', 'UAE']);
    expect((await service.findAll(true)).map(r => r.code)).toEqual(['IND', 'USIT', 'UAE']);
  });

  it('returns shift defaults needed by the operating-unit form', async () => {
    const { service, marketSegment } = makeService();
    await service.findAll();
    expect(marketSegment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ defaultTimezone: true, defaultShift: true, defaultStartTime: true, defaultEndTime: true }),
    }));
  });

  it('allows platform managers to see disabled markets and requires platform permission for mutations', async () => {
    const service = { findAll: jest.fn().mockResolvedValue([]) };
    const controller = new MarketSegmentsController(service as any);
    await controller.findAll({ user: { permissions: ['tenant:manage'] } });
    expect(service.findAll).toHaveBeenLastCalledWith(false);
    await controller.findAll({ user: { permissions: ['platform:manage'] } });
    expect(service.findAll).toHaveBeenLastCalledWith(true);
    for (const method of ['create', 'update', 'remove']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, MarketSegmentsController.prototype[method])).toEqual(['platform:manage']);
    }
  });
});
