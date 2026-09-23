import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Headers,
  HttpStatus, HttpCode, UseGuards, ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth,
} from '@nestjs/swagger';
import { PodsService, PodResponse } from './pods.service';
import { CreatePodDto } from './dtos/create-pod.dto';
import { UpdatePodDto } from './dtos/update-pod.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

function isTenantAdminUser(user: AuthUser): boolean {
  const roles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
  const perms: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
  const sysRole = (user?.systemRole || '').toUpperCase();
  return (
    roles.includes('SUPER_ADMIN') ||
    roles.includes('ADMIN') ||
    sysRole === 'SUPER_ADMIN' ||
    sysRole === 'ADMIN' ||
    perms.includes('tenant:settings') ||
    perms.includes('tenant:manage')
  );
}

function getUserAllowedBranchIds(user: AuthUser): string[] {
  return user?.branchId ? [user.branchId] : [];
}

@ApiTags('ATS Recruitment Pods')
@Controller('api/pods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PodsController {
  constructor(private readonly podsService: PodsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod:create')
  @ApiOperation({ summary: 'Create a new recruitment pod' })
  @ApiResponse({ status: 201, description: 'Pod created successfully.' })
  @ApiQuery({ name: 'businessUnitId', required: false, description: 'Filter/associate pod with operating unit UUID' })
  async create(
    @Body() dto: CreatePodDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string,
  ): Promise<PodResponse> {
    const tid = resolveTenantId(user, tenantId);
    const isTenantAdmin = isTenantAdminUser(user);

    const roles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
    const isUnitAdmin = roles.includes('UNIT_ADMIN') || user?.systemRole === 'UNIT_ADMIN';

    let effectiveBusinessUnitId = dto.businessUnitId || queryBusinessUnitId || (isUnitAdmin ? user.businessUnitId : undefined);

    if (isUnitAdmin && user.businessUnitId) {
      if (dto.businessUnitId && dto.businessUnitId !== user.businessUnitId) {
        throw new ForbiddenException('Access denied. Unit admins can only create recruitment pods in their assigned operating unit.');
      }
      effectiveBusinessUnitId = user.businessUnitId;
    }

    let effectiveBranchId = dto.branchId || queryBranchId || headerBranchId || user.branchId;

    if (!isTenantAdmin) {
      const allowedBranchIds = getUserAllowedBranchIds(user);
      if (dto.branchId && allowedBranchIds.length > 0 && !allowedBranchIds.includes(dto.branchId)) {
        throw new ForbiddenException('Access denied. You can only create recruitment pods within your assigned branch office.');
      }
      effectiveBranchId = dto.branchId || user.branchId || allowedBranchIds[0] || headerBranchId;
      if (!effectiveBranchId && !effectiveBusinessUnitId) {
        throw new ForbiddenException('You must be assigned to a branch office or operating unit to create recruitment pods.');
      }
      dto.branchId = effectiveBranchId;
    }

    return this.podsService.create(dto, tid, effectiveBranchId, effectiveBusinessUnitId);
  }

  @Get()
  @RequirePermissions('pod:view')
  @ApiOperation({ summary: 'List all pods in the workspace' })
  @ApiResponse({ status: 200, description: 'Return pods list.' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter pods by branch UUID' })
  @ApiQuery({ name: 'businessUnitId', required: false, description: 'Filter pods by operating unit UUID' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string,
  ): Promise<PodResponse[]> {
    const tid = resolveTenantId(user, tenantId);
    const isTenantAdmin = isTenantAdminUser(user);

    const roles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
    const isUnitAdmin = roles.includes('UNIT_ADMIN') || user?.systemRole === 'UNIT_ADMIN';

    let effectiveBusinessUnitId = queryBusinessUnitId || (isUnitAdmin ? user.businessUnitId : undefined);

    let effectiveBranchId: string | undefined;
    if (isTenantAdmin) {
      effectiveBranchId = (queryBranchId && queryBranchId !== 'all') ? queryBranchId : headerBranchId;
    } else {
      const allowedBranchIds = getUserAllowedBranchIds(user);
      if (queryBranchId && queryBranchId !== 'all') {
        if (allowedBranchIds.length > 0 && !allowedBranchIds.includes(queryBranchId)) {
          throw new ForbiddenException('Access denied. You can only view recruitment pods in your assigned branch office.');
        }
        effectiveBranchId = queryBranchId;
      } else {
        effectiveBranchId = (headerBranchId && (allowedBranchIds.length === 0 || allowedBranchIds.includes(headerBranchId)))
          ? headerBranchId
          : (user.branchId || allowedBranchIds[0]);
      }

      if (!effectiveBranchId && !effectiveBusinessUnitId) {
        return [];
      }
    }

    return this.podsService.findAll(tid, effectiveBranchId, effectiveBusinessUnitId);
  }

  @Get('available-recruiters')
  @RequirePermissions('pod:view')
  @ApiOperation({ summary: 'Get recruiters not associated with any pod' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter available recruiters by branch UUID' })
  @ApiQuery({ name: 'businessUnitId', required: false, description: 'Filter available recruiters by operating unit UUID' })
  async getAvailableRecruiters(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string,
  ): Promise<any[]> {
    const tid = resolveTenantId(user, tenantId);
    const isTenantAdmin = isTenantAdminUser(user);

    const roles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
    const isUnitAdmin = roles.includes('UNIT_ADMIN') || user?.systemRole === 'UNIT_ADMIN';

    let effectiveBusinessUnitId = queryBusinessUnitId || (isUnitAdmin ? user.businessUnitId : undefined);

    let effectiveBranchId: string | undefined;
    if (isTenantAdmin) {
      effectiveBranchId = (queryBranchId && queryBranchId !== 'all') ? queryBranchId : headerBranchId;
    } else {
      const allowedBranchIds = getUserAllowedBranchIds(user);
      effectiveBranchId = (queryBranchId && (allowedBranchIds.length === 0 || allowedBranchIds.includes(queryBranchId)))
        ? queryBranchId
        : (user.branchId || allowedBranchIds[0] || headerBranchId);
    }

    return this.podsService.getAvailableRecruiters(tid, effectiveBranchId, effectiveBusinessUnitId);
  }

  @Get('my-team')
  @RequirePermissions('pod:view')
  @ApiOperation({ summary: 'Get logged-in user\'s active pod/team details' })
  async findMyTeam(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<PodResponse> {
    const tid = resolveTenantId(user, tenantId);
    return this.podsService.findMyTeam(user.dbId, tid);
  }

  @Get(':id')
  @RequirePermissions('pod:view')
  @ApiOperation({ summary: 'Get a single pod profile by ID' })
  @ApiParam({ name: 'id', description: 'Pod UUID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<PodResponse> {
    const tid = resolveTenantId(user, tenantId);
    const pod = await this.podsService.findOne(id, tid);
    const isTenantAdmin = isTenantAdminUser(user);
    if (!isTenantAdmin && pod.branchId) {
      const allowedBranchIds = getUserAllowedBranchIds(user);
      if (!allowedBranchIds.includes(pod.branchId)) {
        throw new ForbiddenException('Access denied. This recruitment pod belongs to another branch office.');
      }
    }
    return pod;
  }

  @Patch(':id')
  @RequirePermissions('pod:edit')
  @ApiOperation({ summary: 'Update pod metadata or members' })
  @ApiParam({ name: 'id', description: 'Pod UUID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePodDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<PodResponse> {
    const tid = resolveTenantId(user, tenantId);
    const isTenantAdmin = isTenantAdminUser(user);
    if (!isTenantAdmin) {
      const existingPod = await this.podsService.findOne(id, tid);
      const allowedBranchIds = getUserAllowedBranchIds(user);
      if (existingPod.branchId && !allowedBranchIds.includes(existingPod.branchId)) {
        throw new ForbiddenException('Access denied. You cannot modify recruitment pods of another branch office.');
      }
      if (dto.branchId && !allowedBranchIds.includes(dto.branchId)) {
        throw new ForbiddenException('Access denied. You cannot reassign recruitment pods to another branch office.');
      }
    }
    return this.podsService.update(id, dto, tid);
  }

  @Delete(':id')
  @RequirePermissions('pod:delete')
  @ApiOperation({ summary: 'Delete a pod and release members' })
  @ApiParam({ name: 'id', description: 'Pod UUID' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const isTenantAdmin = isTenantAdminUser(user);
    if (!isTenantAdmin) {
      const existingPod = await this.podsService.findOne(id, tid);
      const allowedBranchIds = getUserAllowedBranchIds(user);
      if (existingPod.branchId && !allowedBranchIds.includes(existingPod.branchId)) {
        throw new ForbiddenException('Access denied. You cannot delete recruitment pods of another branch office.');
      }
    }
    return this.podsService.remove(id, tid);
  }

  @Post('reset-cycle')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod:reset_cycle')
  @ApiOperation({ summary: 'Reset round-robin assignment cycle availability' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter reset by branch UUID' })
  @ApiQuery({ name: 'businessUnitId', required: false, description: 'Filter reset by operating unit UUID' })
  async resetCycle(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string,
    @Body('branchId') bodyBranchId?: string,
    @Body('businessUnitId') bodyBusinessUnitId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const isTenantAdmin = isTenantAdminUser(user);

    const roles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
    const isUnitAdmin = roles.includes('UNIT_ADMIN') || user?.systemRole === 'UNIT_ADMIN';

    let effectiveBusinessUnitId = bodyBusinessUnitId || queryBusinessUnitId || (isUnitAdmin ? user.businessUnitId : undefined);

    let effectiveBranchId: string | undefined;
    if (isTenantAdmin) {
      effectiveBranchId = bodyBranchId || ((queryBranchId && queryBranchId !== 'all') ? queryBranchId : headerBranchId);
    } else {
      const allowedBranchIds = getUserAllowedBranchIds(user);
      const requested = bodyBranchId || queryBranchId;
      if (requested && requested !== 'all' && allowedBranchIds.length > 0 && !allowedBranchIds.includes(requested)) {
        throw new ForbiddenException('Access denied. You can only reset round-robin cycle for your assigned branch office.');
      }
      effectiveBranchId = (requested && (allowedBranchIds.length === 0 || allowedBranchIds.includes(requested)))
        ? requested
        : (user.branchId || allowedBranchIds[0] || headerBranchId);
    }

    return this.podsService.resetCycle(tid, effectiveBranchId, effectiveBusinessUnitId);
  }
}
