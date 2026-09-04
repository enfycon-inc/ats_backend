import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessUnitDto } from './dtos/create-business-unit.dto';
import { UpdateBusinessUnitDto } from './dtos/update-business-unit.dto';

export interface BusinessUnitResponse {
  id: string;
  name: string;
  code: string | null;
  market: string;
  currency: string;
  usersCount: number;
  jobsCount: number;
  createdAt: string;
}

@Injectable()
export class BusinessUnitsService {
  private readonly logger = new Logger(BusinessUnitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBusinessUnitDto, tenantId: string): Promise<BusinessUnitResponse> {
    this.logger.log(`Creating business unit "${dto.name}" for tenant ${tenantId}`);

    const existing = await this.prisma.businessUnit.findFirst({
      where: {
        tenantId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException(`A business unit with the name "${dto.name}" already exists.`);
    }

    const code = dto.code ? dto.code.trim().toUpperCase() : dto.name.substring(0, 4).toUpperCase();
    const market = dto.market ? dto.market.trim().toUpperCase() : 'US';
    const currency = dto.currency ? dto.currency.trim().toUpperCase() : (market === 'INDIA' ? 'INR' : 'USD');

    const bu = await this.prisma.businessUnit.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        code,
        market,
        currency,
      },
    });

    return this.findOne(bu.id, tenantId);
  }

  async findAll(tenantId: string): Promise<BusinessUnitResponse[]> {
    const units = await this.prisma.businessUnit.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            users: true,
            jobs: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return units.map((bu) => ({
      id: bu.id,
      name: bu.name,
      code: bu.code,
      market: bu.market,
      currency: bu.currency,
      usersCount: bu._count.users,
      jobsCount: bu._count.jobs,
      createdAt: bu.createdAt.toISOString(),
    }));
  }

  async findOne(id: string, tenantId: string): Promise<BusinessUnitResponse> {
    const bu = await this.prisma.businessUnit.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: {
            users: true,
            jobs: true,
          },
        },
      },
    });

    if (!bu) {
      throw new NotFoundException(`Business Unit with ID ${id} not found.`);
    }

    return {
      id: bu.id,
      name: bu.name,
      code: bu.code,
      market: bu.market,
      currency: bu.currency,
      usersCount: bu._count.users,
      jobsCount: bu._count.jobs,
      createdAt: bu.createdAt.toISOString(),
    };
  }

  async update(id: string, dto: UpdateBusinessUnitDto, tenantId: string): Promise<BusinessUnitResponse> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name.trim().toUpperCase() !== existing.name.toUpperCase()) {
      const conflict = await this.prisma.businessUnit.findFirst({
        where: {
          tenantId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          id: { not: id },
        },
      });

      if (conflict) {
        throw new ConflictException(`A business unit with the name "${dto.name}" already exists.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const market = dto.market !== undefined ? dto.market.trim().toUpperCase() : existing.market;
    const currency = dto.currency !== undefined ? dto.currency.trim().toUpperCase() : existing.currency;

    await this.prisma.businessUnit.update({
      where: { id },
      data: {
        name,
        code,
        market,
        currency,
      },
    });

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    await this.prisma.businessUnit.delete({
      where: { id },
    });
    return { message: 'Business Unit deleted successfully.' };
  }
}
