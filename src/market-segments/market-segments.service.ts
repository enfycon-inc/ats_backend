import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMarketSegmentDto } from './dtos/create-market-segment.dto';
import { UpdateMarketSegmentDto } from './dtos/update-market-segment.dto';

@Injectable()
export class MarketSegmentsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.ATS_SKIP_BOOTSTRAP === 'true') return;
    // Serialize initialization across replicas: nullable tenant IDs do not provide
    // a unique constraint for global codes in PostgreSQL.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71620431)::text`;
      const standards = [
        { name: 'India Staffing', code: 'IND', defaultCurrency: 'INR', defaultTimezone: 'Asia/Kolkata', defaultShift: 'India Shift', sortOrder: 0 },
        { name: 'US IT Staffing', code: 'USIT', defaultCurrency: 'USD', defaultTimezone: 'America/New_York', defaultShift: 'US Shift', sortOrder: 1 },
        { name: 'UAE Staffing', code: 'UAE', defaultCurrency: 'AED', defaultTimezone: 'Asia/Dubai', defaultShift: 'UAE Shift', sortOrder: 2 },
      ];
      for (const market of standards) {
        const existing = await tx.marketSegment.findFirst({
          where: { tenantId: null, code: market.code },
        });
        if (!existing) {
          await tx.marketSegment.create({
            data: { ...market, tenantId: null, isActive: true, defaultStartTime: '09:00', defaultEndTime: '18:00' },
          });
        }
      }
    });
  }

  async findAll(includeInactive = false) {
    return this.prisma.marketSegment.findMany({
      where: { tenantId: null, ...(includeInactive ? {} : { isActive: true }) },
      
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        defaultCurrency: true,
        defaultTimezone: true,
        defaultShift: true,
        defaultStartTime: true,
        defaultEndTime: true,
                                        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { businessUnits: true } },
      },
    });
  }

  async findOne(id: string) {
    const segment = await this.prisma.marketSegment.findFirst({
      where: { id },
      include: {
        businessUnits: {
          select: { id: true, name: true, code: true },
        },
      },
    });
    if (!segment) {
      throw new NotFoundException(`Market segment ${id} not found`);
    }
    return segment;
  }

  async create(dto: CreateMarketSegmentDto) {
    const existing = await this.prisma.marketSegment.findFirst({
      where: { code: dto.code.toUpperCase() },
    });
    if (existing) {
      throw new ConflictException(
        `A market segment with code "${dto.code}" already exists`,
      );
    }
    return this.prisma.marketSegment.create({
      data: {
        
        name: dto.name,
        code: dto.code.toUpperCase(),
        description: dto.description,
        defaultCurrency: dto.defaultCurrency ?? 'USD',
                                        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateMarketSegmentDto) {
    await this.findOne( id);
    if (dto.code) {
      const conflict = await this.prisma.marketSegment.findFirst({
        where: {  code: dto.code.toUpperCase(), NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(
          `A market segment with code "${dto.code}" already exists`,
        );
      }
    }
    return this.prisma.marketSegment.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code.toUpperCase() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.defaultCurrency !== undefined && { defaultCurrency: dto.defaultCurrency }),
                                        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(id: string) {
    const segment = await this.findOne( id);
    // Check if any business units use this segment
    if ((segment as any)._count?.businessUnits > 0 || segment.businessUnits?.length > 0) {
      throw new ConflictException(
        'Cannot delete a market segment that is assigned to operating units. Reassign or remove the units first.',
      );
    }
    return this.prisma.marketSegment.delete({ where: { id } });
  }
}
