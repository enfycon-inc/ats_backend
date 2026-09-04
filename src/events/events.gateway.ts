import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly prisma: PrismaService) {}

  // Maps userId / userEmail -> Set of active socket IDs
  private userSockets = new Map<string, Set<string>>();

  private broadcastOnlineUsers() {
    try {
      const onlineKeys = Array.from(this.userSockets.keys());
      this.server?.emit('online_users_list', onlineKeys);
    } catch (e) {
      this.logger.error('Failed to broadcast online users list', e);
    }
  }

  handleConnection(client: Socket) {
    const userId = (client.handshake.auth?.userId || client.handshake.query?.userId) as string;
    const userEmail = (client.handshake.auth?.email || client.handshake.query?.email) as string;

    this.logger.log(`[WS] Connection attempt: socket ${client.id}, userId: ${userId}, email: ${userEmail}`);

    if (userId) {
      const key = String(userId).toLowerCase();
      if (!this.userSockets.has(key)) {
        this.userSockets.set(key, new Set());
      }
      this.userSockets.get(key)?.add(client.id);
    }

    if (userEmail) {
      const emailKey = String(userEmail).toLowerCase();
      if (!this.userSockets.has(emailKey)) {
        this.userSockets.set(emailKey, new Set());
      }
      this.userSockets.get(emailKey)?.add(client.id);
    }

    this.logger.log(`[WS] Client connected: ${client.id}`);
    this.broadcastOnlineUsers();
  }

  handleDisconnect(client: Socket) {
    const userId = (client.handshake.auth?.userId || client.handshake.query?.userId) as string;
    const userEmail = (client.handshake.auth?.email || client.handshake.query?.email) as string;

    if (userId) {
      const key = String(userId).toLowerCase();
      if (this.userSockets.has(key)) {
        this.userSockets.get(key)?.delete(client.id);
        if ((this.userSockets.get(key)?.size ?? 0) === 0) {
          this.userSockets.delete(key);
        }
      }
    }

    if (userEmail) {
      const emailKey = String(userEmail).toLowerCase();
      if (this.userSockets.has(emailKey)) {
        this.userSockets.get(emailKey)?.delete(client.id);
        if ((this.userSockets.get(emailKey)?.size ?? 0) === 0) {
          this.userSockets.delete(emailKey);
        }
      }
    }

    this.logger.log(`[WS] Client disconnected: ${client.id}`);
    this.broadcastOnlineUsers();
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { time: new Date().toISOString() });
  }

  @SubscribeMessage('get_online_users')
  handleGetOnlineUsers(@ConnectedSocket() client: Socket) {
    client.emit('online_users_list', Array.from(this.userSockets.keys()));
  }

  /**
   * Send a real-time event to a specific user by their UUID or email.
   */
  async sendToUser(userIdOrEmail: string, event: string, payload: any) {
    if (!userIdOrEmail) return;
    const targetKeys = new Set<string>();
    targetKeys.add(String(userIdOrEmail).toLowerCase());

    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrEmail);
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            ...(isUuid ? [{ id: userIdOrEmail }] : []),
            { email: { equals: userIdOrEmail, mode: 'insensitive' } },
          ],
        },
        select: { id: true, email: true },
      });
      if (user) {
        if (user.id) targetKeys.add(String(user.id).toLowerCase());
        if (user.email) targetKeys.add(String(user.email).toLowerCase());
      }
    } catch {}

    const targetSocketIds = new Set<string>();
    for (const key of targetKeys) {
      const sockets = this.userSockets.get(key);
      if (sockets && sockets.size > 0) {
        for (const socketId of sockets) {
          targetSocketIds.add(socketId);
        }
      }
    }

    let sent = false;
    for (const socketId of targetSocketIds) {
      this.server?.to(socketId).emit(event, payload);
      sent = true;
    }

    if (!sent) {
      this.logger.debug(`[WS] sendToUser: user ${userIdOrEmail} is not currently connected.`);
    }
  }

  /**
   * Broadcast an event to multiple user IDs or emails.
   */
  async sendToUsers(userIds: string[], event: string, payload: any) {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    for (const id of uniqueUserIds) {
      await this.sendToUser(id, event, payload);
    }
  }

  /**
   * Broadcast to all connected users belonging to a specific branch.
   */
  async sendToBranch(tenantId: string, branchId: string, event: string, payload: any) {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [
            { branchId },
            { assignedBranchIds: { has: branchId } },
          ],
        },
        select: { id: true, email: true },
      });
      const userKeys = users.flatMap(u => [u.id, u.email]);
      this.sendToUsers(userKeys, event, payload);
    } catch (e: any) {
      this.logger.error(`Failed to broadcast to branch ${branchId}: ${e.message}`);
    }
  }

  /**
   * Broadcast to all connected users who are Administrators / Tenant Admins.
   */
  async sendToAdmins(tenantId: string, event: string, payload: any) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT u.id, u.email 
         FROM ats.users u
         LEFT JOIN ats.custom_roles cr ON cr.id = u.role_id
         WHERE u.tenant_id = $1 AND u.is_active = true
           AND (
             cr.system_role IN ('ADMIN', 'BRANCH_ADMIN', 'SUPER_ADMIN') OR
             UPPER(cr.name) IN ('ADMIN', 'SUPER_ADMIN', 'BRANCH_ADMIN', 'BRANCH ADMIN') OR
             EXISTS (
               SELECT 1 FROM ats.custom_roles sub_cr
               WHERE (sub_cr.id = u.role_id OR sub_cr.id = ANY(COALESCE(u.assigned_role_ids, '{}')))
                 AND (sub_cr.system_role IN ('ADMIN', 'BRANCH_ADMIN', 'SUPER_ADMIN') OR UPPER(sub_cr.name) IN ('ADMIN', 'SUPER_ADMIN', 'BRANCH_ADMIN', 'BRANCH ADMIN'))
             ) OR
             EXISTS (
               SELECT 1 FROM ats.role_permissions rp 
               WHERE (rp.role_id = u.role_id OR rp.role_id = ANY(COALESCE(u.assigned_role_ids, '{}')))
                 AND rp.permission IN ('tenant:settings', 'branch_admin:manage', 'user:manage')
             )
           )`,
        tenantId
      );
      const adminKeys = rows.flatMap(u => [u.id, u.email]);
      this.sendToUsers(adminKeys, event, payload);
    } catch (e: any) {
      this.logger.error(`Failed to broadcast to admins: ${e.message}`);
    }
  }

  /**
   * Global broadcast to all connected users in a tenant.
   */
  broadcastAll(tenantId: string, event: string, payload: any) {
    this.server.emit(event, { ...payload, tenantId });
  }
}
