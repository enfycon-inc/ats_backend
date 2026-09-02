import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
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
    private readonly db: DatabaseService,
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
        const uRes = await this.db.query(
          'SELECT id FROM users WHERE tenant_id = $1 AND (LOWER(email) = LOWER($2) OR LOWER(full_name) = LOWER($2)) LIMIT 1',
          [tenantId, userId]
        );
        if (uRes.rows.length > 0) {
          targetUuid = uRes.rows[0].id;
        } else {
          this.logger.warn(`Could not resolve user UUID for notification target: "${userId}"`);
          return null;
        }
      }

      const res = await this.db.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, message, data, initiator_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id, tenant_id as "tenantId", user_id as "userId", type, title, message, data,
                   is_read as "isRead", initiator_id as "initiatorId", created_at as "createdAt"`,
        [
          tenantId,
          targetUuid,
          payload.type,
          payload.title,
          payload.message,
          JSON.stringify(payload.data || {}),
          payload.initiatorId || null,
        ]
      );

      const notification = res.rows[0];

      // 1. Dispatch real-time WebSocket event to target user
      await this.events.sendToUser(targetUuid, 'notification', {
        ...notification,
        timestamp: notification.createdAt,
      });

      // 2. Fetch sender info for admin live stream
      let initiatorUser: any = null;
      if (payload.initiatorId) {
        const initRes = await this.db.query(
          `SELECT u.id, u.email, u.full_name as "fullName", COALESCE(cr.name, 'Staff') as "roleName" 
           FROM users u 
           LEFT JOIN custom_roles cr ON cr.id = u.role_id
           WHERE u.id::text = $1 OR u.email = $1 LIMIT 1`,
          [payload.initiatorId]
        ).catch(() => ({ rows: [] }));
        initiatorUser = initRes.rows[0] ? { ...initRes.rows[0], roles: [initRes.rows[0].roleName] } : null;
      }

      // 3. Fetch recipient info for admin feed
      const recipientRes = await this.db.query(
        `SELECT u.id, u.email, u.full_name as "fullName", COALESCE(cr.name, 'Staff') as "roleName" 
         FROM users u 
         LEFT JOIN custom_roles cr ON cr.id = u.role_id
         WHERE u.id = $1 LIMIT 1`,
        [targetUuid]
      ).catch(() => ({ rows: [] }));
      const recipientUser = recipientRes.rows[0] ? { ...recipientRes.rows[0], roles: [recipientRes.rows[0].roleName] } : null;

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
    const results: any[] = [];
    for (const uId of validIds) {
      const n = await this.create(tenantId, uId, payload);
      if (n) results.push(n);
    }
    return results;
  }

  /**
   * Retrieve paginated notifications for a user.
   */
  async findAll(tenantId: string, userId: string, page = 1, limit = 20) {
    const skip = Math.max(0, (page - 1) * limit);

    const countRes = await this.db.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_read = false) as unread 
       FROM notifications 
       WHERE tenant_id = $1 
         AND (user_id::text = $2 OR user_id IN (SELECT id FROM users WHERE id::text = $2 OR LOWER(email) = LOWER($2)))`,
      [tenantId, userId]
    );

    const total = parseInt(countRes.rows[0]?.total || '0', 10);
    const unreadCount = parseInt(countRes.rows[0]?.unread || '0', 10);

    const listRes = await this.db.query(
      `SELECT n.id, n.tenant_id as "tenantId", n.user_id as "userId", n.type, n.title, n.message, n.data,
              n.is_read as "isRead", n.initiator_id as "initiatorId", n.created_at as "createdAt",
              u.full_name as "initiatorName", u.email as "initiatorEmail"
       FROM notifications n
       LEFT JOIN users u ON u.id::text = n.initiator_id OR u.email = n.initiator_id
       WHERE n.tenant_id = $1 
         AND (n.user_id::text = $2 OR n.user_id IN (SELECT id FROM users WHERE id::text = $2 OR LOWER(email) = LOWER($2)))
       ORDER BY n.created_at DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, userId, limit, skip]
    );

    return {
      data: listRes.rows.map((n) => ({
        ...n,
        timestamp: n.createdAt,
      })),
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
    await this.db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 AND tenant_id = $3',
      [id, userId, tenantId]
    );
    return { success: true };
  }

  /**
   * Toggle or update read status of a notification (Admin / System).
   */
  async toggleNotificationStatus(id: string, tenantId: string, isRead?: boolean) {
    if (typeof isRead === 'boolean') {
      await this.db.query(
        'UPDATE notifications SET is_read = $1 WHERE id = $2 AND tenant_id = $3',
        [isRead, id, tenantId]
      );
    } else {
      await this.db.query(
        'UPDATE notifications SET is_read = NOT is_read WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
    }
    const res = await this.db.query(
      'SELECT id, is_read as "isRead" FROM notifications WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    return res.rows[0] || { success: true };
  }

  /**
   * Mark all unread notifications as read for a user.
   */
  async markAllAsRead(userId: string, tenantId: string) {
    await this.db.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND tenant_id = $2 AND is_read = false',
      [userId, tenantId]
    );
    return { success: true };
  }

  /**
   * Retrieve notification sound and alert preferences for a user.
   */
  async getUserSettings(userId: string) {
    const res = await this.db.query(
      `SELECT sound_enabled as "soundEnabled", sound_preset as "soundPreset",
              toast_enabled as "toastEnabled", job_alerts as "jobAlerts",
              review_alerts as "reviewAlerts", submission_alerts as "submissionAlerts"
       FROM user_notification_settings
       WHERE user_id = $1`,
      [userId]
    );

    if (res.rows.length === 0) {
      return {
        soundEnabled: true,
        soundPreset: 'CLASSIC_CHIME',
        toastEnabled: true,
        jobAlerts: true,
        reviewAlerts: true,
        submissionAlerts: true,
      };
    }

    return res.rows[0];
  }

  /**
   * Update notification preferences for a user.
   */
  async updateUserSettings(userId: string, settings: any) {
    await this.db.query(
      `INSERT INTO user_notification_settings (
        user_id, sound_enabled, sound_preset, toast_enabled, job_alerts, review_alerts, submission_alerts, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        sound_enabled = EXCLUDED.sound_enabled,
        sound_preset = EXCLUDED.sound_preset,
        toast_enabled = EXCLUDED.toast_enabled,
        job_alerts = EXCLUDED.job_alerts,
        review_alerts = EXCLUDED.review_alerts,
        submission_alerts = EXCLUDED.submission_alerts,
        updated_at = NOW()`,
      [
        userId,
        settings.soundEnabled !== false,
        settings.soundPreset || 'CLASSIC_CHIME',
        settings.toastEnabled !== false,
        settings.jobAlerts !== false,
        settings.reviewAlerts !== false,
        settings.submissionAlerts !== false,
      ]
    );

    return this.getUserSettings(userId);
  }

  /**
   * Admin Global Feed: List all notifications across the tenant with rich filters.
   */
  async findAllForAdmin(
    tenantId: string,
    page = 1,
    limit = 50,
    filters?: { type?: string; branchId?: string; search?: string }
  ) {
    const skip = Math.max(0, (page - 1) * limit);
    const params: any[] = [tenantId];
    let whereSql = 'WHERE n.tenant_id = $1';

    if (filters?.type && filters.type !== 'ALL') {
      params.push(filters.type);
      whereSql += ` AND n.type = $${params.length}`;
    }

    if (filters?.branchId && filters.branchId !== 'ALL') {
      params.push(filters.branchId);
      whereSql += ` AND (u.branch_id = $${params.length}::uuid OR $${params.length}::uuid = ANY(u.assigned_branch_ids))`;
    }

    if (filters?.search) {
      params.push(`%${filters.search.toLowerCase()}%`);
      whereSql += ` AND (LOWER(n.title) LIKE $${params.length} OR LOWER(n.message) LIKE $${params.length} OR LOWER(u.full_name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`;
    }

    const countRes = await this.db.query(
      `SELECT COUNT(*) as total 
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       ${whereSql}`,
      params
    );

    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const listParams = [...params, limit, skip];
    const listRes = await this.db.query(
      `SELECT n.id, n.tenant_id as "tenantId", n.user_id as "userId", n.type, n.title, n.message, n.data,
              n.is_read as "isRead", n.initiator_id as "initiatorId", n.created_at as "createdAt",
              u.full_name as "recipientName", u.email as "recipientEmail", COALESCE(cr_u.name, 'Staff') as "recipientRoleName",
              COALESCE(job_b.name, init_b.name, b.name) as "branchName",
              b.name as "recipientBranchName",
              init.full_name as "initiatorName", init.email as "initiatorEmail", COALESCE(cr_init.name, 'Staff') as "initiatorRoleName"
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       LEFT JOIN custom_roles cr_u ON cr_u.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN branches job_b ON job_b.id::text = (n.data->>'branchId')
       LEFT JOIN users init ON init.id::text = n.initiator_id OR init.email = n.initiator_id
       LEFT JOIN branches init_b ON init_b.id = init.branch_id
       LEFT JOIN custom_roles cr_init ON cr_init.id = init.role_id
       ${whereSql}
       ORDER BY n.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return {
      data: listRes.rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        data: n.data,
        isRead: n.isRead,
        createdAt: n.createdAt,
        timestamp: n.createdAt,
        branchName: n.branchName,
        user: {
          id: n.userId,
          fullName: n.recipientName || 'Unknown',
          email: n.recipientEmail || '',
          roles: n.recipientRoleName ? [n.recipientRoleName] : [],
        },
        initiator: n.initiatorName
          ? {
              fullName: n.initiatorName,
              email: n.initiatorEmail,
              roles: n.initiatorRoleName ? [n.initiatorRoleName] : [],
            }
          : null,
      })),
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
    payload: { title: string; message: string; target: 'ALL' | 'BRANCH' | 'ROLE'; targetId?: string }
  ) {
    let targetUserIds: string[] = [];

    if (payload.target === 'BRANCH' && payload.targetId) {
      const res = await this.db.query(
        `SELECT id FROM users 
         WHERE tenant_id = $1 AND is_active = true 
           AND (branch_id = $2::uuid OR $2::uuid = ANY(assigned_branch_ids))`,
        [tenantId, payload.targetId]
      );
      targetUserIds = res.rows.map(r => r.id);
    } else if (payload.target === 'ROLE' && payload.targetId) {
      const targetRoleNorm = payload.targetId.toUpperCase().replace(/[\s-_]/g, '');
      const res = await this.db.query(
        `SELECT u.id, u.role_id, u.assigned_role_ids, cr.name as custom_role_name, cr.system_role
         FROM users u
         LEFT JOIN custom_roles cr ON cr.id = u.role_id
         WHERE u.tenant_id = $1 AND u.is_active = true`,
        [tenantId]
      );
      targetUserIds = res.rows.filter(u => {
        const customNorm = (u.custom_role_name || '').toUpperCase().replace(/[\s-_]/g, '');
        const sysNorm = (u.system_role || '').toUpperCase().replace(/[\s-_]/g, '');
        return customNorm === targetRoleNorm || sysNorm === targetRoleNorm || (u.role_id && u.role_id === payload.targetId) || (Array.isArray(u.assigned_role_ids) && u.assigned_role_ids.includes(payload.targetId));
      }).map(u => u.id);
    } else {
      // ALL active users in tenant
      const res = await this.db.query(
        'SELECT id FROM users WHERE tenant_id = $1 AND is_active = true',
        [tenantId]
      );
      targetUserIds = res.rows.map(r => r.id);
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
