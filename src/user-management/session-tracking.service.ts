import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { publicClientIp } from './client-ip';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { deviceLabel } from './management-policy';
import type { Presence } from './user-management.contract';

@Injectable()
export class SessionTrackingService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionTrackingService.name);
  private readonly checkpoints = new Map<string, number>();
  private subscriber: any;
  constructor(private readonly db: PrismaService, @InjectQueue('user-management') private readonly queue: Queue) {}
  get enabled() { return process.env.USER_MANAGEMENT_TELEMETRY_ENABLED === 'true'; }
  /** Only call with the result of the existing server-side verified login flow. */
  async loginResult(result: any, req: any, method: string) {
    if (!this.enabled || !result?.accessToken || !result?.user?.id || !result.user.tenantId) return;
    const claims = JSON.parse(Buffer.from(result.accessToken.split('.')[1], 'base64url').toString('utf8'));
    const user = result.user;
    await this.observe({ ...user, dbId: user.id, keycloakId: claims.sub, isActive: true }, claims, req, method);
  }
  ip(req: any): string | null {
    if (req.skipNetworkObservation) return null;
    // Express resolves this using the explicitly configured trusted proxy chain.
    return publicClientIp(req.ip || req.socket?.remoteAddress);
  }
  async observe(actor: AuthUser, claims: any, req: any, method?: string) {
    if ((actor as any).homeTenantId) return;
    const sid = claims.sid || claims.session_state;
    if (!sid || !claims.sub || !Number.isFinite(claims.exp) || !Number.isFinite(claims.auth_time || claims.iat)) {
      if (!this.enabled) return;
      throw new UnauthorizedException('The sign-in session cannot be verified. Please sign in again.');
    }
    const client = claims.azp || process.env.KEYCLOAK_CLIENT_ID;
    if (!client) throw new UnauthorizedException('The sign-in client is missing.');
    const access = await this.db.$queryRawUnsafe<any[]>('SELECT is_active,session_valid_after FROM ats.users WHERE id=$1::uuid AND tenant_id=$2::uuid', actor.dbId, actor.tenantId);
    if (!access[0]?.is_active || (access[0].session_valid_after && (claims.auth_time || claims.iat) * 1000 <= new Date(access[0].session_valid_after).getTime())) {
      throw new UnauthorizedException('Workspace access has changed. A new sign-in is required.');
    }
    const rows = await this.db.$queryRawUnsafe<any[]>(`SELECT m.id, m.revoked_at, m.last_seen_at
      FROM ats.session_memberships m JOIN ats.application_sessions s ON s.id=m.session_id
      WHERE s.provider_subject=$1 AND s.provider_session=$2 AND s.provider_client=$3
      AND m.user_id=$4::uuid AND m.tenant_id=$5::uuid`, claims.sub, sid, client, actor.dbId, actor.tenantId);
    if (rows[0]?.revoked_at) throw new UnauthorizedException('This workspace session has been ended. Please sign in again.');
    // Disabling collection must never reactivate sessions revoked while it was enabled.
    if (!this.enabled) { (actor as any).sessionMembershipId = rows[0]?.id; return; }
    let membership = rows[0];
    const now = Date.now();
    const checkpointKey = `${actor.tenantId}:${actor.dbId}:${sid}`;
    if (!membership || method || now - (this.checkpoints.get(checkpointKey) || 0) > 60_000) {
      membership = await this.db.$transaction(async tx => {
        const sessions = await tx.$queryRawUnsafe<any[]>(`INSERT INTO ats.application_sessions
          (provider_subject,provider_session,provider_client,started_at,expires_at,login_method,device,verified_login)
          VALUES ($1,$2,$3,to_timestamp($4),NOW()+make_interval(secs => $5::int),$6,$7,$8)
          ON CONFLICT(provider_subject,provider_session,provider_client) DO UPDATE SET
          expires_at=GREATEST(ats.application_sessions.expires_at,EXCLUDED.expires_at),
          login_method=CASE WHEN EXCLUDED.verified_login THEN EXCLUDED.login_method ELSE ats.application_sessions.login_method END,
          device=CASE WHEN ats.application_sessions.device LIKE 'Unknown browser%' THEN EXCLUDED.device ELSE ats.application_sessions.device END,
          verified_login=ats.application_sessions.verified_login OR EXCLUDED.verified_login
          RETURNING id`, claims.sub, sid, client, claims.auth_time || claims.iat, 12 * 60 * 60,
          method || 'Not recorded', deviceLabel(String(req.headers?.['user-agent'] || '').slice(0, 1024)), !!method);
        const members = await tx.$queryRawUnsafe<any[]>(`INSERT INTO ats.session_memberships(session_id,user_id,tenant_id)
          SELECT $1::uuid,u.id,u.tenant_id FROM ats.users u WHERE u.id=$2::uuid AND u.tenant_id=$3::uuid AND u.is_active=true
          ON CONFLICT(session_id,user_id) DO UPDATE SET last_seen_at=NOW()
          WHERE ats.session_memberships.revoked_at IS NULL RETURNING id,revoked_at,last_seen_at`, sessions[0].id, actor.dbId, actor.tenantId);
        if (!members[0]) throw new UnauthorizedException('This workspace session is no longer active.');
        const ip = this.ip(req);
        if (ip) await tx.$executeRawUnsafe(`INSERT INTO ats.session_network_observations(membership_id,ip_address)
          SELECT $1::uuid,$2::inet WHERE NOT EXISTS (SELECT 1 FROM
          (SELECT ip_address FROM ats.session_network_observations WHERE membership_id=$1::uuid ORDER BY observed_at DESC LIMIT 1) latest
          WHERE latest.ip_address=$2::inet)`, members[0].id, ip);
        if (method) {
          await tx.$executeRawUnsafe(`INSERT INTO ats.user_security_events(tenant_id,user_id,actor_id,membership_id,event_key,action,outcome,ip_address)
            VALUES($1::uuid,$2::uuid,$2::uuid,$3::uuid,$4,'login.succeeded','success',$5::inet)
            ON CONFLICT(event_key) DO NOTHING`, actor.tenantId, actor.dbId, members[0].id, `login:${members[0].id}`, ip);
          await tx.$executeRawUnsafe('UPDATE ats.users SET last_login_at=GREATEST(COALESCE(last_login_at, to_timestamp(0)),to_timestamp($2)) WHERE id=$1::uuid', actor.dbId, claims.auth_time || claims.iat);
        }
        return members[0];
      });
      this.checkpoints.set(checkpointKey, now);
      if (this.checkpoints.size > 10000) this.checkpoints.clear();
    }
    (actor as any).sessionMembershipId = membership.id;
  }
  async heartbeat(actor: AuthUser, connectionId: string, active: boolean) {
    if (!this.enabled || !(actor as any).sessionMembershipId) return;
    await this.redisWork(async redis => {
    const key = `um:presence:${actor.tenantId}:${actor.dbId}`;
    const field = `${(actor as any).sessionMembershipId}:${connectionId}`;
    const prior = await redis.hget(key, field);
    const old = prior ? JSON.parse(prior) : null;
    redis.defineCommand('umHeartbeat', { numberOfKeys: 1, lua: "redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]); redis.call('EXPIRE',KEYS[1],180); return 1" });
    await redis.runCommand('umHeartbeat', [key, field, JSON.stringify({ seen: Date.now(), active: active ? Date.now() : old?.active || 0 })]);
    });
  }
  async disconnect(actor: AuthUser, connectionId: string) {
    if (!this.enabled || !(actor as any).sessionMembershipId) return;
    await this.redisWork(redis => redis.hdel(`um:presence:${actor.tenantId}:${actor.dbId}`, `${(actor as any).sessionMembershipId}:${connectionId}`));
  }
  async presences(tenantId: string, ids: string[]): Promise<Map<string, Presence>> {
    const result = new Map<string, Presence>(ids.map(id => [id, 'unknown']));
    if (!this.enabled || !ids.length) return result;
    try {
      const values = await this.redisWork(async redis => {
      const pipeline = redis.pipeline();
      ids.forEach(id => pipeline.hgetall(`um:presence:${tenantId}:${id}`));
      return pipeline.exec();
      });
      ids.forEach((id, i) => {
        if (!values || values[i]?.[0]) return;
        const observations = Object.values((values[i]?.[1] || {}) as Record<string, string>).map(raw => JSON.parse(raw));
        const fresh = observations.filter(value => Date.now() - value.seen < 90_000);
        result.set(id, fresh.some(value => Date.now() - value.active < 300_000) ? 'active' : fresh.length ? 'away' : 'offline');
      });
    } catch { this.logger.warn('Presence store unavailable; returning unknown status.'); }
    return result;
  }
  async publish(event: string, payload: unknown, room: string) {
    await this.redisWork(async redis => {
    redis.defineCommand('umPublish', { numberOfKeys: 0, lua: "return redis.call('PUBLISH',ARGV[1],ARGV[2])" });
    await redis.runCommand('umPublish', ['um:events', JSON.stringify({ event, payload, room })]);
    });
  }
  async subscribe(deliver: (room: string, event: string, payload: any) => void) {
    const redis = await this.queue.client;
    this.subscriber = redis.duplicate();
    this.subscriber.on('message', (_channel: string, raw: string) => {
      try { const { room, event, payload } = JSON.parse(raw); deliver(room, event, payload); } catch { /* Ignore malformed internal messages. */ }
    });
    await this.subscriber.subscribe('um:events');
  }
  private async redisWork<T>(operation: (redis: Awaited<Queue['client']>) => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([this.queue.client.then(operation), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Presence store request timed out.')), 2000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  onModuleDestroy() { if (this.subscriber) this.subscriber.disconnect(); }
}
