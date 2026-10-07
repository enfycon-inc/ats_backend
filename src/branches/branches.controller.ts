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

  private canManageTenant(user: any) {
    return hasGranularPermission(user, ['tenant:settings', 'tenant:manage', 'platform:manage']);
  }

  private isUnitScoped(user: any) {
    return !this.canManageTenant(user) && !user.permissions?.includes('branch_admin:manage') && user.permissions?.includes('unit_admin:manage');
  }

  private assertBranchAccess(user: any, id: string) {
    if (!this.canManageTenant(user) && (!user.branchId || user.branchId !== id)) {
      throw new ForbiddenException('You can only access your assigned branch.');
    }
  }

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
    // Unapproved / pending users need the full branch list so they can pick a branch
    // during the onboarding role-request flow. Skip branch scoping for them.
    const isPendingUser = req.user.isApproved === false || req.user.is_approved === false;
    if (!isPendingUser && !this.canManageTenant(req.user) && !req.user.branchId) return [];
    if (this.isUnitScoped(req.user)) {
      if (!req.user.branchId || !req.user.businessUnitId) return [];
      const location = await this.branchesService.findLocation(req.user.branchId, tenantId);
      return location ? [location] : [];
    }
    if (!isPendingUser && req.user.branchId && !this.canManageTenant(req.user)) {
      const branch = await this.branchesService.findOne(req.user.branchId, tenantId);
      return branch ? [branch] : [];
    }
    return this.branchesService.findAll(tenantId);
  }

  @Get('delegation-targets')
  async delegationTargets(@Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    if (!hasGranularPermission(req.user, ['job:delegate'])) throw new ForbiddenException('Missing job:delegate permission.');
    return this.branchesService.getDelegationTargets(resolveTenantId(req.user, headerTenantId), req.user.branchId);
  }


  @Get('hierarchy')
  async getHierarchy(@Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    if (!this.canManageTenant(req.user)) {
      throw new ForbiddenException('Branch directory access requires tenant administration permissions.');
    }
    return this.branchesService.getHierarchy(tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    this.assertBranchAccess(req.user, id);
    const tenantId = resolveTenantId(req.user, headerTenantId);
    if (this.isUnitScoped(req.user)) return this.branchesService.findLocation(id, tenantId);
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
    if (!hasGranularPermission(req.user, ['tenant:settings', 'tenant:manage'])) {
      if (req.user.branchId !== id) {
        throw new ForbiddenException('Access denied. You can only modify your assigned branch location.');
      }
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
    if (!hasGranularPermission(req.user, ['tenant:settings', 'tenant:manage'])) {
      if (req.user.branchId !== id) {
        throw new ForbiddenException('Access denied. You can only modify your assigned branch location.');
      }
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
    this.assertBranchAccess(req.user, id);
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
    this.assertBranchAccess(req.user, id);
    const tenantId = resolveTenantId(req.user, headerTenantId);
    if (this.isUnitScoped(req.user)) {
      if (!req.user.businessUnitId) return [];
      return this.branchesService.getMembers(id, tenantId, req.user.businessUnitId);
    }
    return this.branchesService.getMembers(id, tenantId);
  }

  @Post(':id/assign-user')
  async assignUser(
    @Param('id') id: string,
    @Body('userId') userId: string,
    @Body('roles') roles: string[],
    @Body('businessUnitId') businessUnitId: string | undefined,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:assign_user', 'branch_admin:manage', 'user:manage', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch_admin:manage or user:manage) to assign users to this branch.');
    }
    if (!hasGranularPermission(req.user, ['tenant:settings', 'tenant:manage'])) {
      if (req.user.branchId !== id) {
        throw new ForbiddenException('Access denied. You can only assign users to your assigned branch location.');
      }
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    if (this.isUnitScoped(req.user)) throw new ForbiddenException('Use unit administration to manage your assigned unit members.');
    return this.branchesService.assignUser(id, userId, tenantId, roles, businessUnitId);
  }

  @Patch(':id/managers')
  async updateManagers(
    @Param('id') id: string,
    @Body('managerIds') managerIds: string[],
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    if (!hasGranularPermission(req.user, ['branch:assign_manager', 'branch_admin:manage', 'user:manage', 'tenant:settings'])) {
      throw new ForbiddenException('Access denied. You do not have granular permission (branch_admin:manage or user:manage) to assign or change Branch Heads.');
    }
    if (!hasGranularPermission(req.user, ['tenant:settings', 'tenant:manage'])) {
      if (req.user.branchId !== id) {
        throw new ForbiddenException('Access denied. You can only assign managers to your assigned branch location.');
      }
    }
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.updateManagers(id, managerIds || [], tenantId);
  }
}
