import { Test } from '@nestjs/testing';
import { JobsService } from './jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('job service startup preserves database', () => {
  it('initializes without changing schema or rewriting saved job codes', async () => {
    const execute = jest.fn();
    const module = await Test.createTestingModule({ providers: [JobsService,
      { provide: PrismaService, useValue: { $executeRawUnsafe: execute } },
      { provide: NotificationsService, useValue: {} },
    ] }).compile();
    await module.init();
    expect(execute).not.toHaveBeenCalled();
    await module.close();
  });
});
