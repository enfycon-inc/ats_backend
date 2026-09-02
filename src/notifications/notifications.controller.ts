import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('api/notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ─── GET /api/notifications ──────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Get current user notifications with unread count' })
  @ApiResponse({ status: 200, description: 'Notifications list and unread count' })
  async getNotifications(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parseInt(page || '1', 10);
    const l = parseInt(limit || '20', 10);
    return this.notificationsService.findAll(user.tenantId, user.dbId, p, l);
  }

  // ─── PATCH /api/notifications/:id/read ────────────────────────
  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markAsRead(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(id, user.dbId, user.tenantId);
  }

  // ─── PATCH /api/notifications/:id/toggle-read ─────────────────
  @Patch(':id/toggle-read')
  @ApiOperation({ summary: 'Toggle or update notification read status' })
  async toggleNotificationStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body?: { isRead?: boolean },
  ) {
    return this.notificationsService.toggleNotificationStatus(id, user.tenantId, body?.isRead);
  }

  // ─── PATCH /api/notifications/read-all ────────────────────────
  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  async markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllAsRead(user.dbId, user.tenantId);
  }

  // ─── GET /api/notifications/settings ─────────────────────────
  @Get('settings')
  @ApiOperation({ summary: 'Get current user notification sound & alert preferences' })
  async getUserSettings(@CurrentUser() user: AuthUser) {
    return this.notificationsService.getUserSettings(user.dbId);
  }

  // ─── PUT /api/notifications/settings ─────────────────────────
  @Put('settings')
  @ApiOperation({ summary: 'Update notification sound & alert preferences' })
  async updateUserSettings(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      soundEnabled?: boolean;
      soundPreset?: string;
      toastEnabled?: boolean;
      jobAlerts?: boolean;
      reviewAlerts?: boolean;
      submissionAlerts?: boolean;
    },
  ) {
    return this.notificationsService.updateUserSettings(user.dbId, body);
  }

  // ─── GET /api/notifications/admin/all ─────────────────────────
  @Get('admin/all')
  @ApiOperation({ summary: 'Admin Live Notification Feed (all company events)' })
  async getAdminNotifications(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
  ) {
    const p = parseInt(page || '1', 10);
    const l = parseInt(limit || '50', 10);
    return this.notificationsService.findAllForAdmin(user.tenantId, p, l, {
      type,
      branchId,
      search,
    });
  }

  // ─── POST /api/notifications/admin/broadcast ──────────────────
  @Post('admin/broadcast')
  @ApiOperation({ summary: 'Broadcast an announcement to All Users, Specific Branch, or Role' })
  async broadcastAnnouncement(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      title: string;
      message: string;
      target: 'ALL' | 'BRANCH' | 'ROLE';
      targetId?: string;
    },
  ) {
    return this.notificationsService.broadcastAnnouncement(user.tenantId, user, body);
  }
}
