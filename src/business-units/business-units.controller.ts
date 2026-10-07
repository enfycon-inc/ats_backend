import {
  Controller, Patch, ForbiddenException,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Headers,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BusinessUnitsService } from './business-units.service';
import { CreateBusinessUnitDto } from './dtos/create-business-unit.dto';
import { UpdateBusinessUnitDto } from './dtos/update-business-unit.dto';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

@Controller('api/business-units')
@UseGuards(JwtAuthGuard)
export class BusinessUnitsController {
  constructor(private readonly buService: BusinessUnitsService) {}

  private tenantAccess(user: any) {
    return (user?.permissions || []).some((p: string) => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
  }

  private staffScope(user: any) {
    if (this.tenantAccess(user)) return undefined;
    return { branchId: user.branchId, ...(user.permissions?.includes('branch_admin:manage') ? {} : { businessUnitId: user.businessUnitId }) };
  }

  private async assertAccess(user: any, id: string, tenantId: string, mutate = false) {
    const unit = await this.buService.findOne(id, tenantId);
    if (this.tenantAccess(user)) return unit;
    const permissions: string[] = user?.permissions || [];
    if (!user.branchId || unit.branchId !== user.branchId) throw new ForbiddenException('You can only access units in your assigned branch.');
    const branchManager = permissions.includes('branch_admin:manage');
    if (permissions.includes('unit_admin:manage') && !branchManager && id !== user.businessUnitId) throw new ForbiddenException('You can only access your assigned unit.');
    if (mutate && !branchManager && !(permissions.includes('unit_admin:manage') && id === user.businessUnitId)) throw new ForbiddenException('Unit administration permission is required.');
    return unit;
  }

  @Post()
  async create(
    @Body() dto: CreateBusinessUnitDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    if (!this.tenantAccess(req.user) && !(req.user.permissions?.includes('branch_admin:manage') && req.user.branchId && dto.branchId === req.user.branchId)) throw new ForbiddenException('Branch administration is required to create units.');
    return this.buService.create(dto, tenantId);
  }

  @Get()
  async findAll(@Req() req: any, @Query('branchId') branchId?: string, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    if (this.tenantAccess(req.user)) return this.buService.findAll(tenantId, branchId);
    // Administrative listings never widen access for missing assignments.
    if (!req.user.branchId) return [];
    if (branchId && branchId !== req.user.branchId) throw new ForbiddenException('You can only access your assigned branch.');
    if (req.user.permissions?.includes('unit_admin:manage') && !req.user.permissions?.includes('branch_admin:manage')) {
      if (!req.user.businessUnitId) return [];
      return [await this.assertAccess(req.user, req.user.businessUnitId, tenantId)];
    }
    return this.buService.findAll(tenantId, req.user.branchId);
  }

  @Get('onboarding-options')
  async onboardingOptions(@Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    if (req.user.isApproved !== false) throw new ForbiddenException('Onboarding choices are only available to pending members.');
    return this.buService.onboardingOptions(resolveTenantId(req.user, headerTenantId));
  }

  @Get('delegation-targets')
  async delegationTargets(@Req() req: any, @Query('jobId') jobId: string, @Headers('x-tenant-id') headerTenantId?: string) {
    if (!req.user.permissions?.includes('job:delegate')) throw new ForbiddenException('Missing job:delegate permission.');
    return this.buService.getDelegationTargets(req.user, jobId, resolveTenantId(req.user, headerTenantId));
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.assertAccess(req.user, id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessUnitDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    const unit = await this.assertAccess(req.user, id, tenantId, true);
    if (!this.tenantAccess(req.user) && dto.branchId !== undefined && dto.branchId !== unit.branchId) throw new ForbiddenException('Moving units requires tenant administration.');
    return this.buService.update(id, dto, tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    await this.assertAccess(req.user, id, tenantId, true);
    if (!this.tenantAccess(req.user) && !req.user.permissions?.includes('branch_admin:manage')) throw new ForbiddenException('Branch administration is required to delete units.');
    return this.buService.remove(id, tenantId);
  }


  @Get(':id/members')
  async getMembers(@Param('id') id: string, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    await this.assertAccess(req.user, id, tenantId, true);
    return this.buService.getMembers(id, tenantId);
  }

  @Get(':id/candidate-staff')
  async getCandidateStaff(@Param('id') id: string, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    await this.assertAccess(req.user, id, tenantId, true);
    return this.buService.getCandidateStaff(id, tenantId, this.staffScope(req.user));
  }

  @Post(':id/assign-members')
  async assignMembers(@Param('id') id: string, @Body() body: { userIds: string[] }, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    await this.assertAccess(req.user, id, tenantId, true);
    return this.buService.assignMembers(id, body?.userIds || [], tenantId, this.staffScope(req.user));
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    await this.assertAccess(req.user, id, tenantId, true);
    return this.buService.removeMember(id, userId, tenantId);
  }

  @Patch(':id/admins')
  async updateAdmins(@Param('id') id: string, @Body('adminIds') adminIds: string[], @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const user = req.user;
    const permissions: string[] = user?.permissions || [];
    const isTenantManager = permissions.some((p: string) => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
    const isBranchAdmin = permissions.includes('branch_admin:manage') || permissions.includes('branch:edit');

    if (!isTenantManager && !isBranchAdmin) {
      throw new (ForbiddenException)('You do not have permission to assign unit admins.');
    }

    const tenantId = resolveTenantId(req.user, headerTenantId);
    await this.assertAccess(req.user, id, tenantId, true);
    return this.buService.updateAdmins(id, adminIds || [], tenantId);
  }
}

