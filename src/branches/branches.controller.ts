import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dtos/create-branch.dto';
import { UpdateBranchDto } from './dtos/update-branch.dto';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

function hasGranularPermission(user: any, requiredPermissions: string[]): boolean {
  const perms: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
  return requiredPermissions.some((p) => perms.includes(p));
}

@Controller('api/branches')
@UseGuards(JwtAuthGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  async create(
    @Body() dto: CreateBranchDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:create', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. Only Tenant Admins (tenant:settings) or users with branch:create permission can create new branch locations.');
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.create(dto, tenantId);
  }

  @Get()
  async findAll(@Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.findAll(tenantId);
  }

  @Get('hierarchy')
  async getHierarchy(@Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.getHierarchy(tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.findOne(id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:edit', 'branch_admin:manage', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch:edit or branch_admin:manage) to modify this branch location.');
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.update(id, dto, tenantId);
  }

  @Patch(':id/toggle-global-remarks')
  async toggleGlobalRemarks(
    @Param('id') id: string,
    @Body() body: { enableGlobalRemarks?: boolean; selectedGlobalRemarkIds?: string },
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:edit', 'branch_admin:manage', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch:edit or branch_admin:manage) to modify branch stage remarks.');
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.toggleGlobalRemarks(id, tenantId, body?.enableGlobalRemarks, body?.selectedGlobalRemarkIds);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:delete', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch:delete or tenant:settings) to delete branch locations.');
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.remove(id, tenantId);
  }

  @Get(':id/members')
  async getMembers(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.getMembers(id, tenantId);
  }

  @Post(':id/assign-user')
  async assignUser(
    @Param('id') id: string,
    @Body('userId') userId: string,
    @Body('roles') roles: string[],
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:assign_user', 'branch_admin:manage', 'user:manage', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch_admin:manage or user:manage) to assign users to this branch.');
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.assignUser(id, userId, tenantId, roles);
  }

  @Patch(':id/manager')
  async updateManager(
    @Param('id') id: string,
    @Body('managerId') managerId: string | null,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:assign_manager', 'branch_admin:manage', 'user:manage', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch_admin:manage or user:manage) to assign or change Branch Heads.');
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.updateManager(id, managerId, tenantId);
  }
}
