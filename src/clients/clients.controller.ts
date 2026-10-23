import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpStatus,
  HttpCode,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { ClientCreationRequest } from './client-creation.contract';

@ApiTags('Clients')
@Controller('api/clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get('creation-context')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  creationContext(@CurrentUser() user: AuthUser, @Headers('x-tenant-id') tenantId?: string, @Headers('x-branch-id') branchId?: string) {
    return this.clientsService.getCreationContext(resolveTenantId(user, tenantId), user, branchId);
  }

  @Get('visibility-policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
  @ApiBearerAuth()
  getVisibilityPolicy(@CurrentUser() user: AuthUser) {
    return this.clientsService.getVisibilityPolicy(user);
  }

  @Patch('visibility-policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
  @ApiBearerAuth()
  setVisibilityPolicy(@CurrentUser() user: AuthUser, @Body() body: Record<string, boolean>) {
    return this.clientsService.setVisibilityPolicy(user, body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new client' })
  async create(
    @Body() dto: ClientCreationRequest,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.clientsService.createClient(dto, tid, user?.dbId, user);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retrieve all clients' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.clientsService.findAllClients(tid, user, includeDeleted === 'true');
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get client detail by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.clientsService.findOneClient(id, tid, user);
  }

  @Patch(':id/restore')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore a soft-deleted client' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.clientsService.protectResponse(await this.clientsService.restoreClient(id, tid, user?.dbId || user?.email || 'System'), user);
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a client' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const canApprove = 
      userPermissions.includes('client:approve') ||
      userPermissions.includes('tenant:settings') ||
      userPermissions.includes('tenant:manage');

    if (!canApprove) {
      throw new ForbiddenException('Only Delivery Heads, Tenant Admins, Branch Admins, and authorized staff with client:approve permission can approve client accounts.');
    }

    const approvedBy = user?.dbId;
    return this.clientsService.protectResponse(await this.clientsService.approveClient(id, tid, approvedBy), user);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a client' })
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const canReject = 
      userPermissions.includes('client:reject') ||
      userPermissions.includes('client:approve') ||
      userPermissions.includes('tenant:settings') ||
      userPermissions.includes('tenant:manage');

    if (!canReject) {
      throw new ForbiddenException('Only Delivery Heads, Tenant Admins, Branch Admins, and authorized staff with client:reject permission can reject client accounts.');
    }

    const rejectedBy = user?.dbId;
    return this.clientsService.protectResponse(await this.clientsService.rejectClient(id, tid, rejectedBy, body?.reason), user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an existing client' })
  async update(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.clientsService.protectResponse(await this.clientsService.updateClient(id, dto, tid, user?.dbId || 'System', user), user);
  }


  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete a client' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);

    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const canDelete = 
      userPermissions.includes('client:delete') ||
      userPermissions.includes('tenant:settings') ||
      userPermissions.includes('tenant:manage');

    if (!canDelete) {
      throw new ForbiddenException('You do not have permission (client:delete) to delete client accounts.');
    }

    await this.clientsService.deleteClient(id, tid, user?.dbId || user?.email || 'System');
  }
}
