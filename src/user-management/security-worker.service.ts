import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { PrismaService } from '../prisma/prisma.service';
import { AuthKeycloakService } from '../auth/services/auth-keycloak.service';
import { SessionTrackingService } from './session-tracking.service';
import { OfficeLocationService } from './office-location.service';

@Injectable()
export class SecurityWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecurityWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly db: PrismaService, private readonly modules: ModuleRef, private readonly tracking: SessionTrackingService, private readonly office: OfficeLocationService) {}
  onModuleInit() {
    this.timer = setInterval(() => { void this.tick(); }, 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    if ((!this.tracking.enabled && !this.office.enabled) || this.running) return;
    this.running = true;
    try {
      await this.deliverOutbox();
      if (process.env.USER_SECURITY_PROVIDER_EVENTS_ENABLED === 'true') await this.providerEvents();
      await this.expireSessions();
    } catch { this.logger.error('User security worker failed. Pending work will be retried.'); }
    finally { this.running = false; }
  }
  async deliverOutbox() {
    const lease = randomUUID();
    const rows = await this.db.$queryRawUnsafe<any[]>(`UPDATE ats.user_security_outbox SET status='sending',lease_id=$1::uuid,
      attempts=attempts+1,available_at=NOW()+INTERVAL '2 minutes' WHERE id IN
      (SELECT id FROM ats.user_security_outbox WHERE status IN ('pending','sending') AND available_at<=NOW()
      ORDER BY available_at LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING id,room,event,payload,attempts`, lease);
    for (const row of rows) {
      try {
        await this.tracking.publish(row.event, row.payload, row.room);
        await this.db.$executeRawUnsafe("UPDATE ats.user_security_outbox SET status='delivered' WHERE id=$1::uuid AND lease_id=$2::uuid", row.id, lease);
      } catch {
        await this.db.$executeRawUnsafe("UPDATE ats.user_security_outbox SET status='pending',available_at=NOW()+make_interval(secs=>$3::int) WHERE id=$1::uuid AND lease_id=$2::uuid", row.id, lease, Math.min(3600, 2 ** Math.min(row.attempts, 11)));
      }
    }
  }
  async providerEvents() {
    const issuer = process.env.KEYCLOAK_ISSUER;
    const client = process.env.KEYCLOAK_CLIENT_ID;
    if (!issuer || !client) throw new Error('Identity provider settings are incomplete.');
    const parsed = new URL(issuer);
    const realm = parsed.pathname.split('/realms/')[1];
    if (!realm || realm.includes('/')) throw new Error('Invalid realm setting.');
    const base = `${(process.env.KEYCLOAK_INTERNAL_URL || parsed.origin).replace(/\/$/, '')}/admin/realms/${encodeURIComponent(realm)}`;
    const token = await this.modules.get(AuthKeycloakService, { strict: false }).getKeycloakAdminToken();
    if (!token) throw new Error('Provider event access unavailable.');
    const cursor = await this.db.kvStore.findUnique({ where: { key: 'user-security:provider-cursor' } });
    const previous = cursor ? Number(cursor.value) : Date.now() - 300_000;
    const since = Math.max(0, previous - 300_000);
    let newest = previous;
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams({ client, dateFrom: new Date(since).toISOString().slice(0, 10), first: String(page * 100), max: '100' });
      ['LOGIN', 'LOGIN_ERROR', 'LOGOUT', 'LOGOUT_ERROR', 'REFRESH_TOKEN_ERROR'].forEach(type => query.append('type', type));
      const response = await fetch(`${base}/events?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Provider event read failed.');
      const events: any[] = await response.json();
      for (const event of events) {
        if (!Number.isFinite(event.time) || event.time < since || event.clientId !== client) continue;
        await this.ingest(event);
        newest = Math.max(newest, event.time);
      }
      if (events.length < 100 || events.every(event => event.time < since)) break;
      // Refuse to advance the watermark if this window exceeds our processing budget.
      if (page === 49) throw new Error('Provider event backlog exceeds the current batch.');
    }
    await this.db.kvStore.upsert({ where: { key: 'user-security:provider-cursor' }, create: { key: 'user-security:provider-cursor', value: String(newest) }, update: { value: String(newest), updatedAt: new Date() } });
  }
  async ingest(event: any) {
    const hash = createHash('sha256').update(JSON.stringify([event.id, event.time, event.type, event.userId, event.sessionId, event.ipAddress])).digest('hex');
    const bindings = event.userId && event.sessionId ? await this.db.$queryRawUnsafe<any[]>(`SELECT m.id,m.user_id,m.tenant_id FROM ats.session_memberships m
      JOIN ats.application_sessions s ON s.id=m.session_id WHERE s.provider_subject=$1 AND s.provider_session=$2 AND s.provider_client=$3`, event.userId, event.sessionId, event.clientId) : [];
    // Wait for the application's verified membership binding rather than duplicating
    // a login or guessing which workspace a shared identity entered.
    if (event.type === 'LOGIN' && !bindings.length) return;
    // Provider-verified identity can attribute failures only when it has a single tenant membership.
    const known = !bindings.length && event.userId ? await this.db.$queryRawUnsafe<any[]>('SELECT id AS user_id,tenant_id FROM ats.users WHERE keycloak_id=$1 LIMIT 2', event.userId) : [];
    const targets = bindings.length ? bindings : known.length === 1 ? known : [{ id: null, user_id: null, tenant_id: null }];
    const ip = isIP(event.ipAddress || '') ? event.ipAddress : null;
    await this.db.$transaction(async tx => {
      for (const target of targets) {
        const success = !event.type.endsWith('_ERROR');
        const action = event.type === 'LOGIN' ? 'login.succeeded' : event.type === 'LOGIN_ERROR' ? 'login.failed' : event.type === 'LOGOUT' ? 'session.logged_out' : 'authentication.failed';
        const eventKey = event.type === 'LOGIN' && target.id ? `login:${target.id}` : `provider:${hash}:${target.id || target.user_id || 'unknown'}`;
        await tx.$executeRawUnsafe(`INSERT INTO ats.user_security_events(tenant_id,user_id,membership_id,event_key,action,outcome,ip_address,created_at)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::inet,to_timestamp($8)) ON CONFLICT(event_key) DO NOTHING`, target.tenant_id, target.user_id, target.id || null, eventKey, action, success ? 'success' : 'failure', ip, event.time / 1000);
        if (event.type === 'LOGOUT' && target.id) await tx.$executeRawUnsafe('UPDATE ats.session_memberships SET revoked_at=COALESCE(revoked_at,to_timestamp($2)) WHERE id=$1::uuid', target.id, event.time / 1000);
        if (event.type === 'LOGIN' && target.user_id) await tx.$executeRawUnsafe('UPDATE ats.users SET last_login_at=GREATEST(COALESCE(last_login_at,to_timestamp(0)),to_timestamp($2)) WHERE id=$1::uuid', target.user_id, event.time / 1000);
      }
    });
  }
  private async expireSessions() {
    await this.db.$executeRawUnsafe(`INSERT INTO ats.user_security_events(tenant_id,user_id,membership_id,event_key,action,outcome)
      SELECT m.tenant_id,m.user_id,m.id,'expiry:'||m.id,'session.expired','success' FROM ats.session_memberships m
      JOIN ats.application_sessions s ON s.id=m.session_id WHERE s.expires_at<NOW() AND m.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM ats.user_security_events e WHERE e.event_key='expiry:'||m.id) LIMIT 1000
      ON CONFLICT(event_key) DO NOTHING`);
    await this.db.$executeRawUnsafe("DELETE FROM ats.user_security_outbox WHERE status='delivered' AND created_at<NOW()-INTERVAL '7 days'");
    await this.db.$executeRawUnsafe("DELETE FROM ats.office_browser_preferences WHERE (user_id,browser_hash,origin) IN (SELECT user_id,browser_hash,origin FROM ats.office_browser_preferences WHERE decided_at<NOW()-INTERVAL '365 days' LIMIT 1000)");
    const days = Number(process.env.USER_SECURITY_RETENTION_DAYS || 90);
    if (Number.isInteger(days) && days >= 7 && days <= 3650) {
      await this.db.$executeRawUnsafe('DELETE FROM ats.user_security_events WHERE id IN (SELECT id FROM ats.user_security_events WHERE created_at<NOW()-make_interval(days=>$1::int) LIMIT 1000)', days);
      await this.db.$executeRawUnsafe('DELETE FROM ats.office_login_instances WHERE id IN (SELECT id FROM ats.office_login_instances WHERE expires_at<NOW()-make_interval(days=>$1::int) LIMIT 1000)', days);
      await this.db.$executeRawUnsafe('DELETE FROM ats.session_network_observations WHERE id IN (SELECT id FROM ats.session_network_observations WHERE observed_at<NOW()-make_interval(days=>$1::int) LIMIT 1000)', days);
    }
    if (this.office.enabled) {
      const locationDays = Number(process.env.USER_LOCATION_RETENTION_DAYS || 7);
      if (Number.isInteger(locationDays) && locationDays >= 1 && locationDays <= 90) await this.db.$executeRawUnsafe('DELETE FROM ats.office_location_checks WHERE id IN (SELECT id FROM ats.office_location_checks WHERE created_at<NOW()-make_interval(days=>$1::int) LIMIT 1000)', locationDays);
    }
  }
}
