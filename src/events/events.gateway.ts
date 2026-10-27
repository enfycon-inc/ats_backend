import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, ConnectedSocket, MessageBody } from '@nestjs/websockets';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionTrackingService } from '../user-management/session-tracking.service';
import { hasCapability, managementScope } from '../user-management/management-policy';

@Injectable()
@WebSocketGateway({ cors: { origin: (origin, callback) => {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
  callback(null, !origin || allowed.includes(origin) || /^https:\/\/([a-z0-9-]+\.)?(enfyjobs\.com|enfycon\.com)$/.test(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));
} } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsGateway.name);
  @WebSocketServer() server: Server;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly prisma: PrismaService, private readonly modules: ModuleRef, private readonly tracking: SessionTrackingService) {}
  async onModuleInit() {
    void this.tracking.subscribe((room, event, payload) => {
      void this.deliverLocally(room, event, payload).catch(() => this.logger.warn('Realtime event could not be delivered.'));
    }).catch(() => this.logger.error('Realtime messaging unavailable.'));
    this.timer = setInterval(() => {
      for (const socket of this.server?.sockets.sockets.values() || []) void this.refresh(socket).catch(() => socket.disconnect(true));
    }, 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async refresh(client: Socket) {
    if (!client.data.request) throw new Error('Unauthenticated connection');
    const guard = this.modules.get(JwtAuthGuard, { strict: false });
    client.data.actor = await guard.authenticateRequest(client.data.request);
    const actor = client.data.actor;
    const desired = new Set([`user:${actor.tenantId}:${actor.dbId}`, `tenant:${actor.tenantId}`]);
    if (actor.permissions?.some((p: string) => ['user:manage', 'tenant:settings', 'tenant:manage', '*', 'platform:manage'].includes(p))) desired.add(`admins:${actor.tenantId}`);
    for (const room of client.rooms) if (room !== client.id && !desired.has(room)) await client.leave(room);
    for (const room of desired) await client.join(room);
    return client.data.actor;
  }
  private async deliverLocally(room: string, event: string, payload: any) {
    for (const socket of this.server?.sockets.sockets.values() || []) {
      if (!socket.rooms.has(room)) continue;
      if ((event === 'session_revoked' && socket.data.actor?.sessionMembershipId === payload.membershipId) || event === 'account_blocked') { socket.disconnect(true); continue; }
      try { await this.refresh(socket); if (socket.rooms.has(room)) socket.emit(event, payload); }
      catch { socket.disconnect(true); }
    }
  }
  async handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth || {};
      if (typeof auth.token !== 'string' || auth.token.length > 16384) throw new Error('Missing token');
      const request = { headers: { authorization: `Bearer ${auth.token}`, host: client.handshake.headers.host,
        ...(typeof auth.tenantDomain === 'string' ? { 'x-tenant-domain': auth.tenantDomain } : {}),
        ...(typeof auth.activeRoleId === 'string' ? { 'x-active-role-id': auth.activeRoleId } : {}),
        'user-agent': client.handshake.headers['user-agent'] }, skipNetworkObservation: true, socket: { remoteAddress: client.handshake.address } };
      client.data.request = request;
      const actor = await this.refresh(client);
      await client.join(`user:${actor.tenantId}:${actor.dbId}`);
      await client.join(`tenant:${actor.tenantId}`);
      if (actor.permissions?.some((p: string) => ['user:manage', 'tenant:settings', 'tenant:manage', '*', 'platform:manage'].includes(p))) await client.join(`admins:${actor.tenantId}`);
      await this.tracking.heartbeat(actor, client.id, false);
      await this.handleGetOnlineUsers(client);
    } catch { client.disconnect(true); }
  }
  async handleDisconnect(client: Socket) {
    if (client.data.actor) await this.tracking.disconnect(client.data.actor, client.id).catch(() => {});
  }
  @SubscribeMessage('ping') async handlePing(@ConnectedSocket() client: Socket) {
    try { await this.refresh(client); client.emit('pong', { time: new Date().toISOString() }); }
    catch { client.disconnect(true); }
  }
  @SubscribeMessage('presence_heartbeat') async heartbeat(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    if (Date.now() - (client.data.lastHeartbeat || 0) < 10_000) return;
    client.data.lastHeartbeat = Date.now();
    try {
      const actor = await this.refresh(client);
      await this.tracking.heartbeat(actor, client.id, body?.active === true);
      await this.handleGetOnlineUsers(client);
    } catch { client.disconnect(true); }
  }
  @SubscribeMessage('get_online_users') async handleGetOnlineUsers(@ConnectedSocket() client: Socket) {
    if (Date.now() - (client.data.lastOnlineRead || 0) < 10_000) return;
    client.data.lastOnlineRead = Date.now();
    try {
      const actor = await this.refresh(client);
      if (!hasCapability(actor, 'user:presence:view')) { client.emit('online_users_list', []); return; }
      const scope = managementScope(actor);
      const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT u.id FROM ats.users u WHERE ${scope.sql} AND u.is_active=true ORDER BY u.id LIMIT 1000`, ...scope.values);
      const presence = await this.tracking.presences(actor.tenantId, rows.map(u => u.id));
      client.emit('online_users_list', rows.filter(u => ['active', 'away'].includes(presence.get(u.id) || '')).map(u => u.id));
    } catch { client.emit('online_users_list', []); }
  }
  async sendToUser(userIdOrEmail: string, event: string, payload: any) {
    if (!userIdOrEmail) return;
    const uuid = /^[0-9a-f-]{36}$/i.test(userIdOrEmail);
    const users = await this.prisma.user.findMany({ where: uuid ? { id: userIdOrEmail } : { email: { equals: userIdOrEmail, mode: 'insensitive' } }, select: { id: true, tenantId: true }, take: 2 });
    if (users.length !== 1) return;
    const user = users[0];
    await this.deliver(`user:${user.tenantId}:${user.id}`, event, payload);
  }
  async sendToUsers(userIds: string[], event: string, payload: any) {
    await Promise.all([...new Set(userIds.filter(Boolean))].map(id => this.sendToUser(id, event, payload)));
  }
  async sendToBranch(tenantId: string, branchId: string, event: string, payload: any) {
    const users = await this.prisma.user.findMany({ where: { tenantId, branchId, isActive: true }, select: { id: true } });
    await this.sendToUsers(users.map(user => user.id), event, payload);
  }
  async sendToAdmins(tenantId: string, event: string, payload: any) { await this.deliver(`admins:${tenantId}`, event, payload); }
  broadcastAll(tenantId: string, event: string, payload: any) { void this.deliver(`tenant:${tenantId}`, event, payload).catch(() => this.logger.error('Realtime delivery failed.')); }
  private async deliver(room: string, event: string, payload: any) { await this.tracking.publish(event, payload, room); }
}
