import {
  Controller, Get, Post, Patch, Delete, Body, Param, Headers,
  HttpStatus, HttpCode, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth,
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
  async create(
    @Body() dto: CreatePodDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<PodResponse> {
    const tid = resolveTenantId(user, tenantId);
    return this.podsService.create(dto, tid);
  }

  @Get()
  @RequirePermissions('pod:view')
  @ApiOperation({ summary: 'List all pods in the workspace' })
  @ApiResponse({ status: 200, description: 'Return pods list.' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<PodResponse[]> {
    const tid = resolveTenantId(user, tenantId);
    return this.podsService.findAll(tid);
  }

  @Get('available-recruiters')
  @RequirePermissions('pod:view')
  @ApiOperation({ summary: 'Get recruiters not associated with any pod' })
  async getAvailableRecruiters(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<any[]> {
    const tid = resolveTenantId(user, tenantId);
    return this.podsService.getAvailableRecruiters(tid);
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
    return this.podsService.findOne(id, tid);
  }

  @Patch(':id')
  @RequirePermissions('pod:edit')
  @ApiOperation({ summary: 'Update pod metadata or member roster' })
  @ApiParam({ name: 'id', description: 'Pod UUID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePodDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<PodResponse> {
    const tid = resolveTenantId(user, tenantId);
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
    return this.podsService.remove(id, tid);
  }

  @Post('reset-cycle')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod:reset_cycle')
  @ApiOperation({ summary: 'Reset round-robin assignment cycle availability' })
  async resetCycle(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.podsService.resetCycle(tid);
  }
}
