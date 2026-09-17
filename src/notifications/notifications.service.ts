import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

export interface NotificationPayload {
  type: string;
  title: string;
  message: string;
  data?: any;
  initiatorId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Create and persist a single notification for a user, then dispatch live via WebSocket.
   */
  async create(tenantId: string, userId: string, payload: NotificationPayload) {
    try {
      let targetUuid = userId;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
      if (!isUuid) {
        const user = await this.prisma.user.findFirst({
          where: {
            tenantId,
            OR: [
              { email: { equals: userId, mode: 'insensitive' } },
              { fullName: { equals: userId, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (user) {
          targetUuid = user.id;
        } else {
          this.logger.warn(`Could not resolve user UUID for notification target: "${userId}"`);
          return null;
        }
      }

      const notification = await this.prisma.notification.create({
        data: {
          tenantId,
          userId: targetUuid,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          data: payload.data || {},
          initiatorId: payload.initiatorId || null,
        },
      });

      // 1. Dispatch real-time WebSocket event to target user
      await this.events.sendToUser(targetUuid, 'notification', {
        ...notification,
        timestamp: notification.createdAt,
      });

      // 2. Fetch sender info for admin live stream
      let initiatorUser: any = null;
      if (payload.initiatorId) {
        const isInitUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.initiatorId);
        const init = await this.prisma.user.findFirst({
          where: {
            OR: [
              ...(isInitUuid ? [{ id: payload.initiatorId }] : []),
              { email: payload.initiatorId },
            ],
          },
          include: { customRole: { select: { name: true } } },
        });
        if (init) {
          initiatorUser = {
            id: init.id,
            email: init.email,
            fullName: init.fullName,
            roleName: init.customRole?.name || 'Staff',
            roles: [init.customRole?.name || 'Staff'],
          };
        }
      }

      // 3. Fetch recipient info for admin feed
      const recipient = await this.prisma.user.findUnique({
        where: { id: targetUuid },
        include: { customRole: { select: { name: true } } },
      });
      const recipientUser = recipient
        ? {
            id: recipient.id,
            email: recipient.email,
            fullName: recipient.fullName,
            roleName: recipient.customRole?.name || 'Staff',
            roles: [recipient.customRole?.name || 'Staff'],
          }
        : null;

      // 4. Dispatch to connected Tenant Admins
      this.events.sendToAdmins(tenantId, 'admin_notification', {
        ...notification,
        initiator: initiatorUser,
        user: recipientUser,
        timestamp: notification.createdAt,
      });

      return notification;
    } catch (err: any) {
      this.logger.error(`Failed to create notification for user ${userId}: ${err.message}`, err.stack);
      return null;
    }
  }

  /**
   * Create notifications for multiple users in bulk.
   */
  async createMany(tenantId: string, userIds: string[], payload: NotificationPayload) {
    const validIds = Array.from(new Set(userIds.filter(Boolean)));
    const promises = validIds.map(uId => this.create(tenantId, uId, payload));
    const results = await Promise.all(promises);
    return results.filter(Boolean);
  }

  /**
   * Retrieve paginated notifications for a user.
   */
  async findAll(tenantId: string, userId: string, page = 1, limit = 20) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    let resolvedUserId = userId;
    if (!isUuid) {
      const u = await this.prisma.user.findFirst({
        where: { tenantId, email: { equals: userId, mode: 'insensitive' } },
        select: { id: true },
      });
      if (u) resolvedUserId = u.id;
    }

    const skip = Math.max(0, (page - 1) * limit);

    const [total, unreadCount, list] = await Promise.all([
      this.prisma.notification.count({
        where: { tenantId, userId: resolvedUserId },
      }),
      this.prisma.notification.count({
        where: { tenantId, userId: resolvedUserId, isRead: false },
      }),
      this.prisma.notification.findMany({
        where: { tenantId, userId: resolvedUserId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const initiatorIds = [...new Set(list.map((n) => n.initiatorId).filter(Boolean) as string[])];
    const uuidInits = initiatorIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    const emailInits = initiatorIds.filter((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

    const initiators = await this.prisma.user.findMany({
      where: {
        OR: [
          ...(uuidInits.length > 0 ? [{ id: { in: uuidInits } }] : []),
          ...(emailInits.length > 0 ? [{ email: { in: emailInits } }] : []),
        ],
      },
      select: { id: true, email: true, fullName: true },
    });
    const initMap = new Map<string, { fullName: string; email: string }>();
    initiators.forEach((i) => {
      initMap.set(i.id, { fullName: i.fullName, email: i.email });
      initMap.set(i.email, { fullName: i.fullName, email: i.email });
    });

    const data = list.map((n) => {
      const init = n.initiatorId ? initMap.get(n.initiatorId) : null;
      return {
        ...n,
        initiatorName: init?.fullName || null,
        initiatorEmail: init?.email || null,
        timestamp: n.createdAt,
      };
    });

    return {
      data,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(id: string, userId: string, tenantId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, tenantId },
      data: { isRead: true },
    });
    return { success: true };
  }

  /**
   * Toggle or update read status of a notification (Admin / System).
   */
  async toggleNotificationStatus(id: string, tenantId: string, isRead?: boolean) {
    const existing = await this.prisma.notification.findFirst({
      where: { id, tenantId },
    });
    if (!existing) return { success: true };

    const newStatus = typeof isRead === 'boolean' ? isRead : !existing.isRead;
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: newStatus },
      select: { id: true, isRead: true },
    });
    return updated;
  }

  /**
   * Mark all unread notifications as read for a user.
   */
  async markAllAsRead(userId: string, tenantId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, tenantId, isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }

  /**
   * Retrieve notification sound and alert preferences for a user.
   */
  async getUserSettings(userId: string) {
    const settings = await this.prisma.userNotificationSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return {
        soundEnabled: true,
        soundPreset: 'CLASSIC_CHIME',
        toastEnabled: true,
        jobAlerts: true,
        reviewAlerts: true,
        submissionAlerts: true,
      };
    }

    return settings;
  }

  /**
   * Update notification preferences for a user.
   */
  async updateUserSettings(userId: string, settings: any) {
    return await this.prisma.userNotificationSettings.upsert({
      where: { userId },
      create: {
        userId,
        soundEnabled: settings.soundEnabled !== false,
        soundPreset: settings.soundPreset || 'CLASSIC_CHIME',
        toastEnabled: settings.toastEnabled !== false,
        jobAlerts: settings.jobAlerts !== false,
        reviewAlerts: settings.reviewAlerts !== false,
        submissionAlerts: settings.submissionAlerts !== false,
      },
      update: {
        soundEnabled: settings.soundEnabled !== false,
        soundPreset: settings.soundPreset || 'CLASSIC_CHIME',
        toastEnabled: settings.toastEnabled !== false,
        jobAlerts: settings.jobAlerts !== false,
        reviewAlerts: settings.reviewAlerts !== false,
        submissionAlerts: settings.submissionAlerts !== false,
      },
    });
  }

  /**
   * Admin Global Feed: List all notifications across the tenant with rich filters.
   */
  async findAllForAdmin(
    tenantId: string,
    page = 1,
    limit = 50,
    filters?: { type?: string; branchId?: string; search?: string },
  ) {
    const skip = Math.max(0, (page - 1) * limit);
    const where: any = { tenantId };

    if (filters?.type && filters.type !== 'ALL') {
      where.type = filters.type;
    }

    if (filters?.branchId && filters.branchId !== 'ALL') {
      where.user = {
        branchId: filters.branchId,
      };
    }

    if (filters?.search) {
      const search = filters.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, list] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              branchId: true,
              branch: { select: { name: true } },
              customRole: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const initiatorIds = [...new Set(list.map((n) => n.initiatorId).filter(Boolean) as string[])];
    const uuidInits = initiatorIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    const emailInits = initiatorIds.filter((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

    const initiators = await this.prisma.user.findMany({
      where: {
        OR: [
          ...(uuidInits.length > 0 ? [{ id: { in: uuidInits } }] : []),
          ...(emailInits.length > 0 ? [{ email: { in: emailInits } }] : []),
        ],
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        customRole: { select: { name: true } },
      },
    });
    const initMap = new Map<string, any>();
    initiators.forEach((i) => {
      initMap.set(i.id, i);
      initMap.set(i.email, i);
    });

    return {
      data: list.map((n) => {
        const init = n.initiatorId ? initMap.get(n.initiatorId) : null;
        const payloadData = n.data as any;
        const branchName = payloadData?.branchName || n.user?.branch?.name || null;

        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          data: n.data,
          isRead: n.isRead,
          createdAt: n.createdAt,
          timestamp: n.createdAt,
          branchName,
          user: {
            id: n.userId,
            fullName: n.user?.fullName || 'Unknown',
            email: n.user?.email || '',
            roles: n.user?.customRole?.name ? [n.user.customRole.name] : [],
          },
          initiator: init
            ? {
                fullName: init.fullName,
                email: init.email,
                roles: init.customRole?.name ? [init.customRole.name] : [],
              }
            : null,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Broadcast an announcement from Admin to All Users, Specific Branch, or Specific Role.
   */
  async broadcastAnnouncement(
    tenantId: string,
    initiator: any,
    payload: { title: string; message: string; target: 'ALL' | 'BRANCH' | 'ROLE'; targetId?: string },
  ) {
    let targetUserIds: string[] = [];

    if (payload.target === 'BRANCH' && payload.targetId) {
      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          isActive: true,
          branchId: payload.targetId,
        },
        select: { id: true },
      });
      targetUserIds = users.map((u) => u.id);
    } else if (payload.target === 'ROLE' && payload.targetId) {
      const targetRoleId = payload.targetId;
      const targetRoleNorm = targetRoleId.toUpperCase().replace(/[\s-_]/g, '');
      const users = await this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        include: { customRole: { include: { systemRole: true } } },
      });
      targetUserIds = users
        .filter((u) => {
          const customNorm = (u.customRole?.name || '').toUpperCase().replace(/[\s-_]/g, '');
          const sysNorm = (u.customRole?.systemRole?.systemKey || '').toUpperCase().replace(/[\s-_]/g, '');
          return (
            customNorm === targetRoleNorm ||
            sysNorm === targetRoleNorm ||
            (u.roleId && u.roleId === targetRoleId) ||
            (Array.isArray(u.assignedRoleIds) && u.assignedRoleIds.includes(targetRoleId))
          );
        })
        .map((u) => u.id);
    } else {
      const users = await this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true },
      });
      targetUserIds = users.map((u) => u.id);
    }

    const createdNotifications = await this.createMany(tenantId, targetUserIds, {
      type: 'ANNOUNCEMENT',
      title: payload.title,
      message: payload.message,
      data: {
        broadcastTarget: payload.target,
        targetId: payload.targetId,
      },
      initiatorId: initiator?.dbId || initiator?.id || 'System',
    });

    return {
      success: true,
      recipientsCount: targetUserIds.length,
      dispatched: createdNotifications.length,
    };
  }
}
