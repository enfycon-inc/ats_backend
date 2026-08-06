import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateBranchDto } from './dtos/create-branch.dto';
import { UpdateBranchDto } from './dtos/update-branch.dto';

export interface BranchResponse {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  market: string;
  managerId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  isActive: boolean;
  usersCount: number;
  jobsCount: number;
  createdAt: string;
}

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateBranchDto, tenantId: string): Promise<BranchResponse> {
    this.logger.log(`Creating branch "${dto.name}" for tenant ${tenantId}`);

    const tenantRes = await this.db.query(
      'SELECT max_branches FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const maxBranches = tenantRes.rows[0]?.max_branches || 5;

    const countRes = await this.db.query(
      'SELECT COUNT(*)::int as count FROM branches WHERE tenant_id = $1',
      [tenantId]
    );
    const currentBranchesCount = countRes.rows[0]?.count || 0;

    if (currentBranchesCount >= maxBranches) {
      throw new BadRequestException(
        `Branch limit reached. Your subscription plan allows up to ${maxBranches} branches. Please upgrade your plan to add more branches.`
      );
    }

    const nameCheck = await this.db.query(
      'SELECT 1 FROM branches WHERE tenant_id = $1 AND UPPER(name) = $2',
      [tenantId, dto.name.trim().toUpperCase()]
    );
    if (nameCheck.rows.length > 0) {
      throw new ConflictException(`A branch with the name "${dto.name}" already exists.`);
    }

    const code = dto.code ? dto.code.trim().toUpperCase() : dto.name.substring(0, 4).toUpperCase();
    const market = dto.market ? dto.market.trim().toUpperCase() : 'INDIA';

    const res = await this.db.query(
      `INSERT INTO branches (tenant_id, name, code, city, state, country, market)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, dto.name.trim(), code, dto.city || null, dto.state || null, dto.country || 'India', market]
    );
    const branch = res.rows[0];

    return this.findOne(branch.id, tenantId);
  }

  async findAll(tenantId: string): Promise<BranchResponse[]> {
    const res = await this.db.query(
      `SELECT b.*,
              u.full_name AS manager_name,
              u.email AS manager_email,
              (SELECT COUNT(*)::int FROM users WHERE branch_id = b.id) as users_count,
              (SELECT COUNT(*)::int FROM jobs WHERE branch_id = b.id) as jobs_count
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE b.tenant_id = $1
       ORDER BY b.name ASC`,
      [tenantId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
      state: row.state,
      country: row.country,
      market: row.market || 'INDIA',
      managerId: row.manager_id || null,
      managerName: row.manager_name || null,
      managerEmail: row.manager_email || null,
      isActive: row.is_active,
      usersCount: row.users_count || 0,
      jobsCount: row.jobs_count || 0,
      createdAt: row.created_at,
    }));
  }

  async findOne(id: string, tenantId: string): Promise<BranchResponse> {
    const res = await this.db.query(
      `SELECT b.*,
              u.full_name AS manager_name,
              u.email AS manager_email,
              (SELECT COUNT(*)::int FROM users WHERE branch_id = b.id) as users_count,
              (SELECT COUNT(*)::int FROM jobs WHERE branch_id = b.id) as jobs_count
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE b.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Branch with ID ${id} not found.`);
    }

    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
      state: row.state,
      country: row.country,
      market: row.market || 'INDIA',
      managerId: row.manager_id || null,
      managerName: row.manager_name || null,
      managerEmail: row.manager_email || null,
      isActive: row.is_active,
      usersCount: row.users_count || 0,
      jobsCount: row.jobs_count || 0,
      createdAt: row.created_at,
    };
  }

  async update(id: string, dto: UpdateBranchDto, tenantId: string): Promise<BranchResponse> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name.trim().toUpperCase() !== existing.name.toUpperCase()) {
      const nameCheck = await this.db.query(
        'SELECT 1 FROM branches WHERE tenant_id = $1 AND UPPER(name) = $2 AND id <> $3',
        [tenantId, dto.name.trim().toUpperCase(), id]
      );
      if (nameCheck.rows.length > 0) {
        throw new ConflictException(`A branch with the name "${dto.name}" already exists.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const city = dto.city !== undefined ? dto.city : existing.city;
    const state = dto.state !== undefined ? dto.state : existing.state;
    const country = dto.country !== undefined ? dto.country : existing.country;
    const market = dto.market !== undefined ? dto.market.trim().toUpperCase() : existing.market;
    const isActive = dto.isActive !== undefined ? dto.isActive : existing.isActive;

    await this.db.query(
      `UPDATE branches
       SET name = $1, code = $2, city = $3, state = $4, country = $5, market = $6, is_active = $7, updated_at = NOW()
       WHERE id = $8 AND tenant_id = $9`,
      [name, code, city, state, country, market, isActive, id, tenantId]
    );

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    await this.db.query('DELETE FROM branches WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Branch deleted successfully.' };
  }

  async getMembers(branchId: string, tenantId: string) {
    await this.findOne(branchId, tenantId);
    const res = await this.db.query(
      `SELECT id, email, full_name, roles, is_active, pod_id, created_at
       FROM users
       WHERE tenant_id = $1 AND branch_id = $2
       ORDER BY full_name ASC`,
      [tenantId, branchId]
    );
    return res.rows.map(r => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      roles: r.roles || [],
      isActive: r.is_active,
      podId: r.pod_id,
      createdAt: r.created_at
    }));
  }

  async assignUser(branchId: string, userId: string, tenantId: string, roles?: string[]) {
    await this.findOne(branchId, tenantId);
    const userRes = await this.db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found in tenant.');
    }
    if (roles && Array.isArray(roles) && roles.length > 0) {
      await this.db.query('UPDATE users SET branch_id = $1, roles = $2 WHERE id = $3 AND tenant_id = $4', [branchId, roles, userId, tenantId]);
    } else {
      await this.db.query('UPDATE users SET branch_id = $1 WHERE id = $2 AND tenant_id = $3', [branchId, userId, tenantId]);
    }
    return { message: 'User assigned to branch and roles updated successfully.' };
  }

  async updateManager(branchId: string, managerId: string | null, tenantId: string) {
    await this.findOne(branchId, tenantId);
    if (managerId) {
      const userRes = await this.db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [managerId, tenantId]);
      if (userRes.rows.length === 0) {
        throw new NotFoundException('Selected manager user not found in tenant.');
      }
      const rolesRes = await this.db.query('SELECT roles FROM users WHERE id = $1', [managerId]);
      const currentRoles: string[] = rolesRes.rows[0]?.roles || [];
      if (!currentRoles.includes('BRANCH_ADMIN')) {
        const updatedRoles = [...currentRoles, 'BRANCH_ADMIN'];
        await this.db.query('UPDATE users SET roles = $1, branch_id = $2 WHERE id = $3', [updatedRoles, branchId, managerId]);
      } else {
        await this.db.query('UPDATE users SET branch_id = $1 WHERE id = $2', [branchId, managerId]);
      }
    }
    await this.db.query('UPDATE branches SET manager_id = $1 WHERE id = $2 AND tenant_id = $3', [managerId, branchId, tenantId]);
    return this.findOne(branchId, tenantId);
  }

  async getHierarchy(tenantId: string) {
    const tenantRes = await this.db.query(
      `SELECT t.id, t.name, COALESCE(t.domain, td.domain_name, 'deb') as domain
       FROM tenants t
       LEFT JOIN tenant_domains td ON td.tenant_id = t.id AND td.is_primary = TRUE
       WHERE t.id = $1 LIMIT 1`,
      [tenantId]
    );
    const tenant = tenantRes.rows[0];

    const branchesList = await this.findAll(tenantId);
    
    const branchesWithPods = await Promise.all(
      branchesList.map(async (b) => {
        const podsRes = await this.db.query(
          'SELECT id, name, code FROM pods WHERE branch_id = $1 AND tenant_id = $2',
          [b.id, tenantId]
        );
        const members = await this.getMembers(b.id, tenantId);
        
        return {
          ...b,
          pods: podsRes.rows || [],
          members,
        };
      })
    );

    return {
      tenant: tenant || { name: 'Tenant HQ', domain: 'workspace' },
      branches: branchesWithPods,
    };
  }
}
