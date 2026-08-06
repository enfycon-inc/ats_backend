import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
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

  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateBusinessUnitDto, tenantId: string): Promise<BusinessUnitResponse> {
    this.logger.log(`Creating business unit "${dto.name}" for tenant ${tenantId}`);

    // Name uniqueness check
    const nameCheck = await this.db.query(
      'SELECT 1 FROM business_units WHERE tenant_id = $1 AND UPPER(name) = $2',
      [tenantId, dto.name.trim().toUpperCase()]
    );
    if (nameCheck.rows.length > 0) {
      throw new ConflictException(`A business unit with the name "${dto.name}" already exists.`);
    }

    const code = dto.code ? dto.code.trim().toUpperCase() : dto.name.substring(0, 4).toUpperCase();
    const market = dto.market ? dto.market.trim().toUpperCase() : 'US';
    const currency = dto.currency ? dto.currency.trim().toUpperCase() : (market === 'INDIA' ? 'INR' : 'USD');

    const res = await this.db.query(
      `INSERT INTO business_units (tenant_id, name, code, market, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, dto.name.trim(), code, market, currency]
    );
    const bu = res.rows[0];

    return this.findOne(bu.id, tenantId);
  }

  async findAll(tenantId: string): Promise<BusinessUnitResponse[]> {
    const res = await this.db.query(
      `SELECT bu.*,
              (SELECT COUNT(*)::int FROM users WHERE business_unit_id = bu.id) as users_count,
              (SELECT COUNT(*)::int FROM jobs WHERE business_unit_id = bu.id) as jobs_count
       FROM business_units bu
       WHERE bu.tenant_id = $1
       ORDER BY bu.name ASC`,
      [tenantId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      market: row.market || 'US',
      currency: row.currency || 'USD',
      usersCount: row.users_count || 0,
      jobsCount: row.jobs_count || 0,
      createdAt: row.created_at,
    }));
  }

  async findOne(id: string, tenantId: string): Promise<BusinessUnitResponse> {
    const res = await this.db.query(
      `SELECT bu.*,
              (SELECT COUNT(*)::int FROM users WHERE business_unit_id = bu.id) as users_count,
              (SELECT COUNT(*)::int FROM jobs WHERE business_unit_id = bu.id) as jobs_count
       FROM business_units bu
       WHERE bu.id = $1 AND bu.tenant_id = $2`,
      [id, tenantId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Business Unit with ID ${id} not found.`);
    }

    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      market: row.market || 'US',
      currency: row.currency || 'USD',
      usersCount: row.users_count || 0,
      jobsCount: row.jobs_count || 0,
      createdAt: row.created_at,
    };
  }

  async update(id: string, dto: UpdateBusinessUnitDto, tenantId: string): Promise<BusinessUnitResponse> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name.trim().toUpperCase() !== existing.name.toUpperCase()) {
      const nameCheck = await this.db.query(
        'SELECT 1 FROM business_units WHERE tenant_id = $1 AND UPPER(name) = $2 AND id <> $3',
        [tenantId, dto.name.trim().toUpperCase(), id]
      );
      if (nameCheck.rows.length > 0) {
        throw new ConflictException(`A business unit with the name "${dto.name}" already exists.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const market = dto.market !== undefined ? dto.market.trim().toUpperCase() : existing.market;
    const currency = dto.currency !== undefined ? dto.currency.trim().toUpperCase() : existing.currency;

    await this.db.query(
      `UPDATE business_units
       SET name = $1, code = $2, market = $3, currency = $4, updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6`,
      [name, code, market, currency, id, tenantId]
    );

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    await this.db.query('DELETE FROM business_units WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Business Unit deleted successfully.' };
  }
}
