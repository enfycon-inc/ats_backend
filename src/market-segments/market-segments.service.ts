import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMarketSegmentDto } from './dtos/create-market-segment.dto';
import { UpdateMarketSegmentDto } from './dtos/update-market-segment.dto';

@Injectable()
export class MarketSegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.marketSegment.findMany({
      where: { tenantId },
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

  async findOne(tenantId: string, id: string) {
    const segment = await this.prisma.marketSegment.findFirst({
      where: { id, tenantId },
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

  async create(tenantId: string, dto: CreateMarketSegmentDto) {
    const existing = await this.prisma.marketSegment.findFirst({
      where: { tenantId, code: dto.code.toUpperCase() },
    });
    if (existing) {
      throw new ConflictException(
        `A market segment with code "${dto.code}" already exists`,
      );
    }
    return this.prisma.marketSegment.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        description: dto.description,
        defaultCurrency: dto.defaultCurrency ?? 'USD',
        defaultTimezone: dto.defaultTimezone ?? 'America/New_York',
        defaultShift: dto.defaultShift ?? 'General Shift',
        defaultStartTime: dto.defaultStartTime ?? '09:00',
        defaultEndTime: dto.defaultEndTime ?? '18:00',
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateMarketSegmentDto) {
    await this.findOne(tenantId, id);
    if (dto.code) {
      const conflict = await this.prisma.marketSegment.findFirst({
        where: { tenantId, code: dto.code.toUpperCase(), NOT: { id } },
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
        ...(dto.defaultTimezone !== undefined && { defaultTimezone: dto.defaultTimezone }),
        ...(dto.defaultShift !== undefined && { defaultShift: dto.defaultShift }),
        ...(dto.defaultStartTime !== undefined && { defaultStartTime: dto.defaultStartTime }),
        ...(dto.defaultEndTime !== undefined && { defaultEndTime: dto.defaultEndTime }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const segment = await this.findOne(tenantId, id);
    // Check if any business units use this segment
    if ((segment as any)._count?.businessUnits > 0 || segment.businessUnits?.length > 0) {
      throw new ConflictException(
        'Cannot delete a market segment that is assigned to operating units. Reassign or remove the units first.',
      );
    }
    return this.prisma.marketSegment.delete({ where: { id } });
  }
}
