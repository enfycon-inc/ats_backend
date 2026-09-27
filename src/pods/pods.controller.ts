import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Headers, HttpStatus, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PodsService } from './pods.service';
import { CreatePodDto } from './dtos/create-pod.dto';
import { UpdatePodDto } from './dtos/update-pod.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

@ApiTags('ATS Recruitment Pods')
@Controller('api/pods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PodsController {
  constructor(private readonly podsService: PodsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('pod:create')
  async create(@Body() dto: CreatePodDto, @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string, @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string, @Query('businessUnitId') queryBusinessUnitId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const scope = await this.podsService.resolveScope(tid, user, dto.businessUnitId || queryBusinessUnitId, dto.branchId || queryBranchId || headerBranchId, true);
    return this.podsService.create({ ...dto, ...scope }, tid, scope.branchId, scope.businessUnitId);
  }

  @Get()
  @RequirePermissions('pod:view')
  async findAll(@CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string, @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const scope = await this.podsService.resolveScope(tid, user, queryBusinessUnitId, queryBranchId || headerBranchId);
    return this.podsService.findAll(tid, scope.branchId, scope.businessUnitId);
  }

  @Get('available-recruiters')
  @RequirePermissions('pod:view')
  async getAvailableRecruiters(@CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string, @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const scope = await this.podsService.resolveScope(tid, user, queryBusinessUnitId, queryBranchId || headerBranchId, true);
    return this.podsService.getAvailableRecruiters(tid, scope.branchId, scope.businessUnitId);
  }

  @Get('my-team')
  @RequirePermissions('pod:view')
  async findMyTeam(@CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const pod = await this.podsService.findMyTeam(user.dbId, tid);
    await this.podsService.resolveScope(tid, user, pod.businessUnitId || undefined, pod.branchId || undefined, true);
    return pod;
  }

  @Get(':id')
  @RequirePermissions('pod:view')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const pod = await this.podsService.findOne(id, tid);
    await this.podsService.assertPodAccess(tid, user, pod);
    return pod;
  }

  @Patch(':id')
  @RequirePermissions('pod:edit')
  async update(@Param('id') id: string, @Body() dto: UpdatePodDto, @CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const pod = await this.podsService.findOne(id, tid);
    await this.podsService.assertPodAccess(tid, user, pod);
    const scope = await this.podsService.resolveScope(tid, user, dto.businessUnitId || pod.businessUnitId || undefined, dto.branchId || pod.branchId || undefined, true);
    return this.podsService.update(id, { ...dto, ...scope }, tid);
  }

  @Delete(':id')
  @RequirePermissions('pod:delete')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string) {
    const tid = resolveTenantId(user, tenantId);
    await this.podsService.assertPodAccess(tid, user, await this.podsService.findOne(id, tid));
    return this.podsService.remove(id, tid);
  }

  @Post('reset-cycle')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod:reset_cycle')
  async resetCycle(@CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') headerBranchId?: string, @Query('branchId') queryBranchId?: string,
    @Query('businessUnitId') queryBusinessUnitId?: string, @Body('branchId') bodyBranchId?: string,
    @Body('businessUnitId') bodyBusinessUnitId?: string) {
    const tid = resolveTenantId(user, tenantId);
    const scope = await this.podsService.resolveScope(tid, user, bodyBusinessUnitId || queryBusinessUnitId, bodyBranchId || queryBranchId || headerBranchId, true);
    return this.podsService.resetCycle(tid, scope.branchId, scope.businessUnitId);
  }
}
