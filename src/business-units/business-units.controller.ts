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

  @Post()
  async create(
    @Body() dto: CreateBusinessUnitDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.create(dto, tenantId);
  }

  @Get()
  async findAll(@Req() req: any, @Query('branchId') branchId?: string, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.findAll(tenantId, branchId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.findOne(id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessUnitDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.update(id, dto, tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.remove(id, tenantId);
  }


  @Get(':id/members')
  async getMembers(@Param('id') id: string, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.getMembers(id, tenantId);
  }

  @Get(':id/candidate-staff')
  async getCandidateStaff(@Param('id') id: string, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.getCandidateStaff(id, tenantId);
  }

  @Post(':id/assign-members')
  async assignMembers(@Param('id') id: string, @Body() body: { userIds: string[] }, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.assignMembers(id, body?.userIds || [], tenantId);
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
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
    return this.buService.updateAdmins(id, adminIds || [], tenantId);
  }
}

