import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { hasCapability, requireCapability } from './management-policy';

export function geofenceResult(latitude: number, longitude: number, accuracy: number, fence: { latitude: number; longitude: number; radius_metres: number }) {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(rad(latitude - fence.latitude) / 2) ** 2 + Math.cos(rad(latitude)) * Math.cos(rad(fence.latitude)) * Math.sin(rad(longitude - fence.longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  return distance + accuracy <= fence.radius_metres ? 'within' : distance - accuracy > fence.radius_metres ? 'outside' : 'uncertain';
}
@Injectable()
export class OfficeLocationService {
  constructor(private readonly db: PrismaService, @InjectQueue('user-management') private readonly queue: Queue) {}
  get enabled() { return process.env.USER_OFFICE_EVIDENCE_ENABLED === 'true' && process.env.USER_MANAGEMENT_TELEMETRY_ENABLED === 'true'; }
  async branches(actor: AuthUser) {
    requireCapability(actor, 'branch:network:manage');
    const tenantWide = actor.permissions?.some(p => ['*', 'platform:manage', 'tenant:settings', 'tenant:manage'].includes(p));
    const branchIds = [...new Set([...(actor.assignedBranchIds || []), ...(actor.branchId ? [actor.branchId] : [])])];
    return this.db.$queryRawUnsafe<any[]>(`SELECT id,name FROM ats.branches WHERE tenant_id=$1::uuid ${tenantWide ? '' : 'AND id=ANY($2::uuid[])'} ORDER BY name`, ...[actor.tenantId, ...(tenantWide ? [] : [branchIds])]);
  }
  async policy(actor: AuthUser, branchId: string) {
    if (!(await this.branches(actor)).some(branch => branch.id === branchId)) throw new NotFoundException('Office not found in your scope.');
    const networks = await this.db.$queryRawUnsafe<any[]>('SELECT network::text,kind,expires_at AS "expiresAt" FROM ats.branch_networks WHERE tenant_id=$1::uuid AND branch_id=$2::uuid AND expires_at>NOW()', actor.tenantId, branchId);
    return { enabled: this.enabled, networks };
  }
  async save(actor: AuthUser, branchId: string, body: any) {
    await this.policy(actor, branchId);
    if (!Array.isArray(body.networks) || body.networks.length > 10) throw new BadRequestException('Provide up to 10 office or VPN networks.');
    for (const row of body.networks) {
      if (typeof row.network !== 'string') throw new BadRequestException('Invalid network.');
      const [ip, prefix, ...extra] = row.network.trim().split('/');
      const version = isIP(ip);
      if (!version || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || +prefix > (version === 4 ? 32 : 128))) || !['office', 'vpn'].includes(row.kind)) throw new BadRequestException('Provide valid IPv4/IPv6 networks and their connection type.');
      const expiry = new Date(row.expiresAt);
      if (!Number.isFinite(expiry.getTime()) || expiry <= new Date() || expiry.getTime() > Date.now() + 366 * 86400000) throw new BadRequestException('Network verification must expire within one year.');
    }
    await this.db.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM ats.tenants WHERE id=$1::uuid FOR UPDATE', actor.tenantId);
      for (const row of body.networks) {
        const overlap = await tx.$queryRawUnsafe<any[]>('SELECT id FROM ats.branch_networks WHERE tenant_id=$1::uuid AND branch_id<>$2::uuid AND expires_at>NOW() AND network && $3::cidr LIMIT 1', actor.tenantId, branchId, row.network);
        if (overlap.length) throw new BadRequestException('This network overlaps another office mapping. Verify the network before assigning it.');
      }
      await tx.$executeRawUnsafe('DELETE FROM ats.branch_networks WHERE tenant_id=$1::uuid AND branch_id=$2::uuid', actor.tenantId, branchId);
      for (const row of body.networks) await tx.$executeRawUnsafe('INSERT INTO ats.branch_networks(tenant_id,branch_id,network,kind,verified_by,expires_at) VALUES($1::uuid,$2::uuid,$3::cidr,$4,$5::uuid,$6)', actor.tenantId, branchId, row.network, row.kind, actor.dbId, new Date(row.expiresAt));
      await tx.$executeRawUnsafe(`INSERT INTO ats.audit_logs(tenant_id,actor_id,action,target_type,target_id,details) VALUES($1::uuid,$2,'office_network_policy.updated','branch',$3,$4::jsonb)`, actor.tenantId, actor.dbId, branchId, JSON.stringify({ networks: body.networks }));
    });
    return { success: true };
  }
  async geofenceUnits(actor: AuthUser) {
    requireCapability(actor, 'unit:geofence:manage');
    const tenantWide = actor.permissions?.some(p => ['*', 'platform:manage', 'tenant:settings', 'tenant:manage'].includes(p));
    let scopeSql = '';
    const values: unknown[] = [actor.tenantId];
    if (!tenantWide) {
      if (hasCapability(actor, 'unit_admin:manage') && !hasCapability(actor, 'branch_admin:manage')) {
        if (!actor.businessUnitId) throw new ForbiddenException('An operating unit assignment is required.');
        values.push(actor.businessUnitId);
        scopeSql = 'AND bu.id=$2::uuid';
      } else {
        const branchIds = [...new Set([...(actor.assignedBranchIds || []), ...(actor.branchId ? [actor.branchId] : [])])];
        if (!branchIds.length) throw new ForbiddenException('A branch assignment is required.');
        values.push(branchIds);
        scopeSql = 'AND bu.branch_id=ANY($2::uuid[])';
      }
    }
    return this.db.$queryRawUnsafe<any[]>(`SELECT bu.id,bu.name,bu.branch_id AS "branchId",b.name AS "branchName"
      FROM ats.business_units bu JOIN ats.branches b ON b.id=bu.branch_id AND b.tenant_id=bu.tenant_id
      WHERE bu.tenant_id=$1::uuid ${scopeSql} ORDER BY b.name,bu.name`, ...values);
  }
  async unitGeofence(actor: AuthUser, unitId: string) {
    const unit = (await this.geofenceUnits(actor)).find(row => row.id === unitId);
    if (!unit) throw new NotFoundException('Operating unit not found in your authorised scope.');
    const rows = await this.db.$queryRawUnsafe<any[]>('SELECT latitude,longitude,radius_metres AS "radiusMetres" FROM ats.business_unit_geofences WHERE tenant_id=$1::uuid AND business_unit_id=$2::uuid', actor.tenantId, unitId);
    return { enabled: this.enabled, geofence: rows[0] || null };
  }
  async saveUnitGeofence(actor: AuthUser, unitId: string, body: any) {
    const unit = (await this.geofenceUnits(actor)).find(row => row.id === unitId);
    if (!unit) throw new NotFoundException('Operating unit not found in your authorised scope.');
    const fence = body?.geofence;
    if (fence && (![fence.latitude, fence.longitude, fence.radiusMetres].every(Number.isFinite) || Math.abs(fence.latitude) > 90 || Math.abs(fence.longitude) > 180 || !Number.isInteger(fence.radiusMetres) || fence.radiusMetres < 25 || fence.radiusMetres > 5000)) throw new BadRequestException('Provide a valid office position and radius between 25 and 5000 metres.');
    await this.db.$transaction(async tx => {
      if (fence) await tx.$executeRawUnsafe(`INSERT INTO ats.business_unit_geofences(business_unit_id,tenant_id,latitude,longitude,radius_metres,updated_by)
        SELECT bu.id,bu.tenant_id,$3,$4,$5,$6::uuid FROM ats.business_units bu WHERE bu.id=$1::uuid AND bu.tenant_id=$2::uuid
        ON CONFLICT(business_unit_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_metres=EXCLUDED.radius_metres,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, unitId, actor.tenantId, fence.latitude, fence.longitude, fence.radiusMetres, actor.dbId);
      else await tx.$executeRawUnsafe('DELETE FROM ats.business_unit_geofences WHERE business_unit_id=$1::uuid AND tenant_id=$2::uuid', unitId, actor.tenantId);
      await tx.$executeRawUnsafe(`INSERT INTO ats.audit_logs(tenant_id,actor_id,action,target_type,target_id,details) VALUES($1::uuid,$2,'unit_geofence.updated','business_unit',$3,$4::jsonb)`, actor.tenantId, actor.dbId, unitId, JSON.stringify({ geofence: fence || null }));
    });
    return { success: true };
  }
  async context(actor: AuthUser) {
    if (!this.enabled || !actor.businessUnitId) return { enabled: false, configured: false };
    const fences = await this.db.$queryRawUnsafe<any[]>('SELECT 1 FROM ats.business_unit_geofences WHERE tenant_id=$1::uuid AND business_unit_id=$2::uuid', actor.tenantId, actor.businessUnitId);
    return { enabled: true, configured: !!fences.length };
  }
  async networks(tenantId: string, userIds: string[]) {
    if (!this.enabled || !userIds.length) return [];
    return this.db.$queryRawUnsafe<any[]>(`SELECT DISTINCT ON(m.user_id) m.user_id,
      CASE WHEN n.kind='office' THEN 'Office network detected' WHEN n.kind='vpn' THEN 'Company VPN · location unverified' ELSE 'Other network' END AS label,
      b.name AS branch_name,o.observed_at FROM ats.session_memberships m
      JOIN ats.application_sessions s ON s.id=m.session_id
      JOIN LATERAL(SELECT ip_address,observed_at FROM ats.session_network_observations WHERE membership_id=m.id ORDER BY observed_at DESC LIMIT 1) o ON true
      LEFT JOIN ats.branch_networks n ON n.tenant_id=m.tenant_id AND n.expires_at>NOW() AND o.ip_address <<= n.network
      LEFT JOIN ats.branches b ON b.id=n.branch_id AND b.tenant_id=m.tenant_id
      WHERE m.tenant_id=$1::uuid AND m.user_id=ANY($2::uuid[]) AND m.revoked_at IS NULL AND s.expires_at>NOW()
      ORDER BY m.user_id,o.observed_at DESC`, tenantId, userIds);
  }
  async candidates(actor: AuthUser) {
    const offices = await this.branches(actor);
    if (!this.enabled || !offices.length) return [];
    const minimum = Number(process.env.OFFICE_NETWORK_MIN_EMPLOYEES || 5);
    const ratio = Number(process.env.OFFICE_NETWORK_COHORT_RATIO || 0.9);
    const hours = Number(process.env.OFFICE_NETWORK_MIN_HOUR_BUCKETS || 3);
    if (!Number.isInteger(minimum) || minimum < 3 || !Number.isFinite(ratio) || ratio < 0.5 || ratio > 1 || !Number.isInteger(hours) || hours < 2 || hours > 24) throw new BadRequestException('Office discovery policy is not configured correctly.');
    return this.db.$queryRawUnsafe<any[]>(`WITH observed AS (
      SELECT u.branch_id,m.user_id,o.ip_address,o.observed_at FROM ats.session_network_observations o
      JOIN ats.session_memberships m ON m.id=o.membership_id JOIN ats.users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
      WHERE m.tenant_id=$1::uuid AND u.branch_id=ANY($2::uuid[]) AND o.observed_at>NOW()-INTERVAL '24 hours'
    ), totals AS (SELECT branch_id,COUNT(DISTINCT user_id)::float AS employees FROM observed GROUP BY branch_id)
    SELECT x.branch_id,host(x.ip_address) AS network,COUNT(DISTINCT x.user_id)::int AS employees,
      ROUND((COUNT(DISTINCT x.user_id)/MAX(t.employees))::numeric,2)::float AS ratio,MAX(x.observed_at) AS "lastObservedAt"
      FROM observed x JOIN totals t ON t.branch_id=x.branch_id GROUP BY x.branch_id,x.ip_address
      HAVING COUNT(DISTINCT x.user_id)>=$3::int AND COUNT(DISTINCT x.user_id)/MAX(t.employees)>=$4::float
      AND COUNT(DISTINCT date_trunc('hour',x.observed_at))>=$5::int
      ORDER BY employees DESC LIMIT 20`, actor.tenantId, offices.map(office => office.id), minimum, ratio, hours);
  }
  async challenge(actor: AuthUser) {
    if (!(await this.context(actor)).configured) throw new BadRequestException('Office location checks are not configured.');
    const nonce = randomUUID();
    const redis = await this.queue.client;
    await redis.set(`um:location:${actor.tenantId}:${actor.dbId}:${nonce}`, 'valid', { EX: 120 });
    return { challenge: nonce };
  }
  async check(actor: AuthUser, body: any) {
    if (!this.enabled || !actor.businessUnitId) throw new ForbiddenException('Office location checks are unavailable for an account without an assigned operating unit.');
    if (typeof body.challenge !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.challenge) || ![body.latitude, body.longitude, body.accuracy, body.timestamp].every(Number.isFinite) || Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180 || body.accuracy < 0 || body.accuracy > 100000 || Date.now() - body.timestamp > 60000 || body.timestamp > Date.now() + 30000) throw new BadRequestException('A fresh location sample and valid accuracy are required.');
    const redis = await this.queue.client;
    redis.defineCommand('umConsumeLocation', { numberOfKeys: 1, lua: "local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]); end; return v" });
    if (!await redis.runCommand('umConsumeLocation', [`um:location:${actor.tenantId}:${actor.dbId}:${body.challenge}`])) throw new BadRequestException('This location check expired. Please try again.');
    const fences = await this.db.$queryRawUnsafe<any[]>(`SELECT f.latitude,f.longitude,f.radius_metres,bu.branch_id FROM ats.business_unit_geofences f
      JOIN ats.business_units bu ON bu.id=f.business_unit_id AND bu.tenant_id=f.tenant_id
      WHERE f.tenant_id=$1::uuid AND f.business_unit_id=$2::uuid`, actor.tenantId, actor.businessUnitId);
    if (!fences[0]) throw new BadRequestException('Office location checks are not configured.');
    const result = geofenceResult(body.latitude, body.longitude, body.accuracy, fences[0]);
    await this.db.$executeRawUnsafe('INSERT INTO ats.office_location_checks(tenant_id,user_id,branch_id,business_unit_id,result,accuracy_metres,sampled_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7)', actor.tenantId, actor.dbId, fences[0].branch_id, actor.businessUnitId, result, body.accuracy, new Date(body.timestamp));
    return { result, accuracyMetres: body.accuracy, checkedAt: new Date(body.timestamp).toISOString(), source: 'browser-reported' };
  }
}
