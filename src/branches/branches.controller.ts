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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dtos/create-branch.dto';
import { UpdateBranchDto } from './dtos/update-branch.dto';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

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
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.update(id, dto, tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
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
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.branchesService.updateManager(id, managerId, tenantId);
  }
}
