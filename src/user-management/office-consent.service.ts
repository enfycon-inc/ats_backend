import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { OfficeLocationService, geofenceResult } from './office-location.service';
import { OFFICE_LOCATION_NOTICE_VERSION as VERSION, OfficeConsentContext, OfficeConsentClaim, OfficeConsentResult } from './user-management.contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['declined', 'checked', 'browser_denied', 'unavailable']);
type Scope = { loginId: string; browserHash: string; origin: string };

@Injectable()
export class OfficeConsentService {
  constructor(private readonly db: PrismaService, private readonly office: OfficeLocationService,
    @InjectQueue('user-management') private readonly queue: Queue) {}

  async createLogin(actor: AuthUser, requestKey: string): Promise<string | null> {
    const membershipId = (actor as any).sessionMembershipId;
    if (!membershipId) return null;
    const nonce = uuid.test(requestKey || '') ? requestKey : randomUUID();
    const id = randomUUID();
    const receipt = `${id}.${nonce}`;
    const rows = await this.db.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO ats.office_login_instances(id,membership_id,request_hash,receipt_hash,expires_at)
      SELECT $1::uuid,m.id,$2,$3,s.expires_at FROM ats.session_memberships m
      JOIN ats.application_sessions s ON s.id=m.session_id
      WHERE m.id=$4::uuid AND m.tenant_id=$5::uuid AND m.user_id=$6::uuid AND m.revoked_at IS NULL
      ON CONFLICT(membership_id,request_hash) DO UPDATE SET expires_at=GREATEST(ats.office_login_instances.expires_at,EXCLUDED.expires_at)
      RETURNING id`, id, hash(nonce), hash(receipt), membershipId, actor.tenantId, actor.dbId);
    return rows[0] ? `${rows[0].id}.${nonce}` : null;
  }

  private async scope(actor: AuthUser, headers: Record<string, any>): Promise<Scope | null> {
    const receipt = String(headers['x-ats-office-login'] || '');
    const browser = String(headers['x-ats-office-browser'] || '');
    const origin = String(headers['x-ats-office-origin'] || '');
    if (!/^[a-f0-9]{64}$/.test(browser) || origin.length > 255) throw new BadRequestException('Browser context is unavailable.');
    let url: URL;
    try { url = new URL(origin); } catch { throw new BadRequestException('Invalid browser origin.'); }
    if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new BadRequestException('A secure browser origin is required.');
    }
    const parts = receipt.split('.');
    if (parts.length !== 2 || !parts.every(part => uuid.test(part))) return null;
    const rows = await this.db.$queryRawUnsafe<{ id: string }[]>(`SELECT l.id FROM ats.office_login_instances l
      JOIN ats.session_memberships m ON m.id=l.membership_id
      WHERE l.receipt_hash=$1 AND m.tenant_id=$2::uuid AND m.user_id=$3::uuid
      AND m.id=$4::uuid AND m.revoked_at IS NULL AND l.expires_at>NOW()`, hash(receipt), actor.tenantId, actor.dbId, (actor as any).sessionMembershipId || null);
    return rows[0] ? { loginId: rows[0].id, browserHash: hash(browser), origin } : null;
  }

  private async eligibility(actor: AuthUser): Promise<{ reason: OfficeConsentContext['reason']; unitName?: string }> {
    if (!this.office.enabled) return { reason: 'disabled' };
    if (!actor.businessUnitId) return { reason: 'no_unit' };
    const rows = await this.db.$queryRawUnsafe<{ name: string }[]>(`SELECT bu.name FROM ats.business_unit_geofences f
      JOIN ats.business_units bu ON bu.id=f.business_unit_id AND bu.tenant_id=f.tenant_id
      WHERE f.tenant_id=$1::uuid AND f.business_unit_id=$2::uuid`, actor.tenantId, actor.businessUnitId);
    return rows[0] ? { reason: 'ready', unitName: rows[0].name } : { reason: 'no_geofence' };
  }

  async context(actor: AuthUser, headers: Record<string, any>): Promise<OfficeConsentContext> {
    const eligibility = await this.eligibility(actor);
    const base = { ...eligibility, eligible: false, consent: 'unknown' as const, handled: false, noticeVersion: VERSION };
    if (eligibility.reason !== 'ready') return base;
    const scope = await this.scope(actor, headers);
    if (!scope) return { ...base, reason: 'new_login_required' };
    const values = await this.db.$queryRawUnsafe<any[]>(`SELECT p.decision,p.notice_version,
      s.status,s.notice_version AS state_version FROM (SELECT 1) seed
      LEFT JOIN ats.office_browser_preferences p ON p.user_id=$1::uuid AND p.browser_hash=$2 AND p.origin=$3
      LEFT JOIN ats.office_login_location_states s ON s.login_id=$4::uuid AND s.browser_hash=$2 AND s.origin=$3`, actor.dbId, scope.browserHash, scope.origin, scope.loginId);
    const row = values[0] || {};
    return { ...base, eligible: true, loginId: scope.loginId,
      consent: row.notice_version === VERSION ? row.decision || 'unknown' : 'unknown',
      handled: row.state_version === VERSION && TERMINAL.has(row.status) };
  }

  private async ready(actor: AuthUser, headers: Record<string, any>) {
    if ((await this.eligibility(actor)).reason !== 'ready') throw new BadRequestException('Office location collection is not configured for your unit.');
    const scope = await this.scope(actor, headers);
    if (!scope) throw new BadRequestException('Sign in again to start optional office verification.');
    return scope;
  }

  private async state(tx: any, scope: Scope) {
    const rows = await tx.$queryRawUnsafe(`SELECT status,notice_version,lease_token,lease_until,manual FROM ats.office_login_location_states
      WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3 FOR UPDATE`, scope.loginId, scope.browserHash, scope.origin);
    return rows[0];
  }

  private async preference(tx: any, actor: AuthUser, scope: Scope) {
    // Advisory lock serializes consent/withdrawal and result writes, even before a preference row exists.
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', `${actor.dbId}:${scope.browserHash}:${scope.origin}`);
    const rows = await tx.$queryRawUnsafe(`SELECT decision,notice_version FROM ats.office_browser_preferences
      WHERE user_id=$1::uuid AND browser_hash=$2 AND origin=$3`, actor.dbId, scope.browserHash, scope.origin);
    return rows[0];
  }

  async claim(actor: AuthUser, headers: Record<string, any>, body: any): Promise<OfficeConsentClaim> {
    if (!body || !['notice', 'collect'].includes(body.mode) || (body.manual !== undefined && typeof body.manual !== 'boolean')) throw new BadRequestException('Invalid verification request.');
    const scope = await this.ready(actor, headers);
    return this.db.$transaction(async tx => {
      const preference = await this.preference(tx, actor, scope);
      await tx.$executeRawUnsafe(`INSERT INTO ats.office_login_location_states(login_id,browser_hash,origin,notice_version)
        VALUES($1::uuid,$2,$3,$4) ON CONFLICT DO NOTHING`, scope.loginId, scope.browserHash, scope.origin, VERSION);
      const row = await this.state(tx, scope);
      if (body.leaseToken && row.lease_token === body.leaseToken && row.lease_until > new Date() && !TERMINAL.has(row.status)) {
        await tx.$executeRawUnsafe(`UPDATE ats.office_login_location_states SET lease_until=NOW()+INTERVAL '3 minutes'
          WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3`, scope.loginId, scope.browserHash, scope.origin);
        return { claimed: true, leaseToken: row.lease_token };
      }
      if (row.lease_until > new Date() || (!body.manual && row.notice_version === VERSION && TERMINAL.has(row.status))) return { claimed: false };
      if (body.mode === 'collect' && (preference?.decision !== 'accepted' || preference.notice_version !== VERSION)) return { claimed: false };
      const leaseToken = randomUUID();
      await tx.$executeRawUnsafe(`UPDATE ats.office_login_location_states SET status=$4,notice_version=$5,
        lease_token=$6::uuid,lease_until=NOW()+INTERVAL '3 minutes',manual=$7,updated_at=NOW()
        WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3`, scope.loginId, scope.browserHash, scope.origin,
        body.mode === 'collect' ? 'collecting' : 'prompting', VERSION, leaseToken, body.manual === true);
      return { claimed: true, leaseToken };
    });
  }

  private assertLease(row: any, token: unknown) {
    if (!row || !uuid.test(String(token || '')) || row.lease_token !== token || row.lease_until <= new Date() || TERMINAL.has(row.status)) {
      throw new BadRequestException('This verification request expired. Please retry from My Sessions.');
    }
  }

  async decision(actor: AuthUser, headers: Record<string, any>, body: any) {
    if (!body || !['accepted', 'declined'].includes(body.choice) || body.noticeVersion !== VERSION) throw new BadRequestException('Please review the current office location notice.');
    const scope = await this.ready(actor, headers);
    await this.db.$transaction(async tx => {
      await this.preference(tx, actor, scope);
      const row = await this.state(tx, scope);
      if (row?.status === (body.choice === 'declined' ? 'declined' : 'collecting') && row.lease_token === body.leaseToken) return;
      this.assertLease(row, body.leaseToken);
      await tx.$executeRawUnsafe(`INSERT INTO ats.office_browser_preferences(user_id,browser_hash,origin,decision,notice_version)
        VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(user_id,browser_hash,origin) DO UPDATE
        SET decision=EXCLUDED.decision,notice_version=EXCLUDED.notice_version,decided_at=NOW()`, actor.dbId, scope.browserHash, scope.origin, body.choice, VERSION);
      await tx.$executeRawUnsafe(`UPDATE ats.office_login_location_states SET status=$4,lease_until=$5,updated_at=NOW()
        WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3`, scope.loginId, scope.browserHash, scope.origin,
        body.choice === 'accepted' ? 'collecting' : 'declined', body.choice === 'accepted' ? new Date(Date.now() + 180000) : null);
      await tx.$executeRawUnsafe(`INSERT INTO ats.user_security_events(tenant_id,user_id,actor_id,action,outcome,details)
        VALUES($1::uuid,$2::uuid,$2::uuid,'location.consent','success',$3::jsonb)`, actor.tenantId, actor.dbId, JSON.stringify({ choice: body.choice, noticeVersion: VERSION, loginId: scope.loginId }));
    });
    return { success: true };
  }

  async outcome(actor: AuthUser, headers: Record<string, any>, body: any) {
    if (!['browser_denied', 'unavailable'].includes(body?.status)) throw new BadRequestException('Invalid location outcome.');
    const scope = await this.ready(actor, headers);
    await this.db.$transaction(async tx => {
      await this.preference(tx, actor, scope);
      const row = await this.state(tx, scope);
      if (row?.status === body.status && row.lease_token === body.leaseToken) return;
      this.assertLease(row, body.leaseToken);
      await tx.$executeRawUnsafe(`UPDATE ats.office_login_location_states SET status=$4,lease_until=NULL,updated_at=NOW()
        WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3`, scope.loginId, scope.browserHash, scope.origin, body.status);
    });
    return { success: true };
  }

  async withdraw(actor: AuthUser, headers: Record<string, any>) {
    const scope = await this.scope(actor, headers);
    if (!scope) throw new BadRequestException('Sign in again to manage this browser preference.');
    await this.db.$transaction(async tx => {
      await this.preference(tx, actor, scope);
      await tx.$executeRawUnsafe(`UPDATE ats.office_browser_preferences SET decision='declined',decided_at=NOW()
        WHERE user_id=$1::uuid AND browser_hash=$2 AND origin=$3`, actor.dbId, scope.browserHash, scope.origin);
      await tx.$executeRawUnsafe(`INSERT INTO ats.office_login_location_states(login_id,browser_hash,origin,status,notice_version)
        VALUES($1::uuid,$2,$3,'declined',$4) ON CONFLICT(login_id,browser_hash,origin) DO UPDATE SET status='declined',lease_until=NULL,updated_at=NOW()`, scope.loginId, scope.browserHash, scope.origin, VERSION);
    });
    return { success: true };
  }

  async challenge(actor: AuthUser, headers: Record<string, any>, body: any) {
    const scope = await this.ready(actor, headers);
    const row = await this.db.$queryRawUnsafe<any[]>(`SELECT status,notice_version,lease_token,lease_until,manual FROM ats.office_login_location_states WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3`, scope.loginId, scope.browserHash, scope.origin);
    this.assertLease(row[0], body?.leaseToken);
    if (row[0].status !== 'collecting') throw new ForbiddenException('Location consent is required.');
    const challenge = randomUUID();
    const redis = await this.queue.client;
    await redis.set(`um:consent:${scope.loginId}:${scope.browserHash}:${challenge}`, body.leaseToken, { EX: 60 });
    return { challenge };
  }

  async check(actor: AuthUser, headers: Record<string, any>, body: any): Promise<OfficeConsentResult> {
    if (!body || !uuid.test(body.challenge || '') || ![body.latitude, body.longitude, body.accuracy, body.timestamp].every(Number.isFinite)
      || Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180 || body.accuracy < 0 || body.accuracy > 100000
      || Date.now() - body.timestamp > 60000 || body.timestamp > Date.now() + 30000) throw new BadRequestException('A fresh location sample is required.');
    const scope = await this.ready(actor, headers);
    const redis = await this.queue.client;
    redis.defineCommand('umConsentChallenge', { numberOfKeys: 1, lua: "if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('DEL',KEYS[1]);return 1 end;return 0" });
    if (!await redis.runCommand('umConsentChallenge', [`um:consent:${scope.loginId}:${scope.browserHash}:${body.challenge}`, body.leaseToken])) throw new BadRequestException('This location check expired.');
    return this.db.$transaction(async tx => {
      const preference = await this.preference(tx, actor, scope);
      const row = await this.state(tx, scope);
      this.assertLease(row, body.leaseToken);
      if (row.status !== 'collecting' || preference?.decision !== 'accepted' || preference.notice_version !== VERSION || !this.office.enabled) throw new ForbiddenException('Location consent is no longer active.');
      const fences = await tx.$queryRawUnsafe<any[]>(`SELECT f.latitude,f.longitude,f.radius_metres,bu.branch_id FROM ats.business_unit_geofences f
        JOIN ats.business_units bu ON bu.id=f.business_unit_id AND bu.tenant_id=f.tenant_id
        WHERE f.tenant_id=$1::uuid AND f.business_unit_id=$2::uuid FOR SHARE OF f`, actor.tenantId, actor.businessUnitId);
      if (!fences[0]) throw new BadRequestException('Office location checks are no longer configured.');
      const result = geofenceResult(body.latitude, body.longitude, body.accuracy, fences[0]);
      await tx.$executeRawUnsafe(`INSERT INTO ats.office_location_checks(tenant_id,user_id,branch_id,business_unit_id,result,accuracy_metres,sampled_at,login_id,source)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9)`, actor.tenantId, actor.dbId, fences[0].branch_id, actor.businessUnitId,
        result, body.accuracy, new Date(body.timestamp), scope.loginId, row.manual ? 'manual' : 'post_login');
      await tx.$executeRawUnsafe(`UPDATE ats.office_login_location_states SET status='checked',lease_until=NULL,updated_at=NOW()
        WHERE login_id=$1::uuid AND browser_hash=$2 AND origin=$3`, scope.loginId, scope.browserHash, scope.origin);
      return { result, accuracyMetres: body.accuracy, checkedAt: new Date(body.timestamp).toISOString() };
    });
  }
}
