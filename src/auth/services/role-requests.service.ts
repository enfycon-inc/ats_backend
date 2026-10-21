import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuthEmailService } from './auth-email.service';
import type { AuthUser } from '../interfaces/auth-user.interface';
import type {
  RoleRequestReview,
  RoleRequestSubmission,
} from '../role-request-contract';
import { USER_CITY_VALUES, type UserCity } from '../user-city-contract';
import {
  canGrantRequestedRole,
  canReviewRoleRequest,
  permissionList,
  type RequestedRole,
  type RequestScope,
} from '../utils/role-request-policy';

type Db = Pick<
  Prisma.TransactionClient,
  '$queryRawUnsafe' | '$executeRawUnsafe'
>;
type PendingUser = RequestScope & {
  id: string;
  email: string;
  full_name: string;
  requested_role: string | null;
  role_request_version: string | null;
  is_approved: boolean;
  city?: string | null;
};
type Reviewer = {
  id: string;
  email: string;
  full_name: string;
  role_id: string;
  system_key?: string;
  branch_id: string | null;
  business_unit_id: string | null;
  permissions: unknown;
};
type Role = RequestedRole & { name: string; system_key: string | null };
type Delivery = {
  id: string;
  tenant_id: string;
  requester_id: string;
  recipient_id: string;
  request_version: string;
  channel: string;
  attempts: number;
  lease_id: string;
};

@Injectable()
export class RoleRequestsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RoleRequestsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: AuthEmailService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      void this.dispatchPending();
    }, 15000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async resolveRole(
    db: Db,
    tenantId: string,
    identifier: string,
    scope: RequestScope,
  ): Promise<Role> {
    const roles = await db.$queryRawUnsafe<Role[]>(
      `SELECT cr.id, cr.name, cr.permissions, cr.branch_id, cr.business_unit_id, sr.system_key
       FROM ats.custom_roles cr LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id
       WHERE cr.tenant_id = $1::uuid
         AND (LOWER(cr.id::text) = LOWER($2) OR LOWER(cr.name) = LOWER($2) OR LOWER(sr.system_key) = LOWER($2))
         AND (cr.branch_id IS NULL OR cr.branch_id = $3::uuid)
         AND (cr.business_unit_id IS NULL OR cr.business_unit_id = $4::uuid)
       ORDER BY (LOWER(cr.id::text) = LOWER($2)) DESC, cr.is_system ASC, cr.created_at ASC LIMIT 1`,
      tenantId,
      identifier,
      scope.branch_id || null,
      scope.business_unit_id || null,
    );
    const role = roles[0];
    if (!role)
      throw new BadRequestException(
        'The requested role is unavailable in this workspace or office.',
      );
    if (role.system_key === 'POD_LEAD')
      throw new BadRequestException(
        'Pod leadership is assigned through Recruitment Pods.',
      );
    return { ...role, system_role: role.system_key };
  }

  private async reviewers(
    db: Db,
    target: PendingUser,
    role: Role,
    recipientId?: string,
  ): Promise<Reviewer[]> {
    // Evaluate each assigned role independently, matching active-role authorization. Do not
    // combine unrelated role permissions to manufacture an approval capability.
    const rows = await db.$queryRawUnsafe<Reviewer[]>(
      `SELECT u.id, u.email, u.full_name, u.branch_id, u.business_unit_id, cr.id AS role_id, cr.permissions, sr.system_key
       FROM ats.users u JOIN ats.custom_roles cr
         ON cr.tenant_id = u.tenant_id AND (cr.id = u.role_id OR cr.id = ANY(u.assigned_role_ids))
       LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id
       WHERE u.tenant_id = $1::uuid AND u.id <> $2::uuid AND u.is_active = true AND u.is_approved = true
         AND ($3::uuid IS NULL OR u.id = $3::uuid)
         AND (cr.branch_id IS NULL OR cr.branch_id = u.branch_id)
         AND (cr.business_unit_id IS NULL OR cr.business_unit_id = u.business_unit_id)
         AND cr.permissions::jsonb ?| ARRAY['user:manage', '*', 'platform:manage']
       ORDER BY u.id, (cr.id = u.role_id) DESC, cr.id`,
      target.tenant_id,
      target.id,
      recipientId || null,
    );
    const result = new Map<string, Reviewer>();
    for (const row of rows) {
      const actor = {
        dbId: row.id,
        tenantId: target.tenant_id,
        systemRole: row.system_key,
        branchId: row.branch_id || undefined,
        businessUnitId: row.business_unit_id || undefined,
        permissions: permissionList(row.permissions),
      };
      if (
        canReviewRoleRequest(actor, target) &&
        canGrantRequestedRole(actor, role, target) &&
        !result.has(row.id)
      )
        result.set(row.id, row);
    }
    return [...result.values()];
  }

  async submit(
    userId: string,
    identifier: string,
    branchId?: string,
    businessUnitId?: string,
    city?: UserCity | null,
  ): Promise<RoleRequestSubmission> {
    if (
      typeof identifier !== 'string' ||
      !identifier.trim() ||
      identifier.length > 128
    )
      throw new BadRequestException('Select a valid role.');
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      [branchId, businessUnitId].some(
        (id) => id != null && (typeof id !== 'string' || !uuid.test(id)),
      )
    )
      throw new BadRequestException('Select a valid branch and business unit.');
    if (city != null && !USER_CITY_VALUES.includes(city))
      throw new BadRequestException('Select a valid city.');
    return this.prisma.$transaction(async (tx) => {
      const users = await tx.$queryRawUnsafe<PendingUser[]>(
        'SELECT id, tenant_id, email, full_name, requested_role, role_request_version, is_approved, branch_id, business_unit_id, city FROM ats.users WHERE id = $1::uuid FOR UPDATE',
        userId,
      );
      const user = users[0];
      if (!user) throw new NotFoundException('User not found.');
      if (user.is_approved)
        throw new ConflictException(
          'Your account is already approved. Ask a workspace administrator to change assigned roles.',
        );
      if (branchId) {
        const branch = await tx.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM ats.branches WHERE id = $1::uuid AND tenant_id = $2::uuid',
          branchId,
          user.tenant_id,
        );
        if (!branch.length)
          throw new BadRequestException('Select a branch in your workspace.');
      }
      if (businessUnitId) {
        const unit = await tx.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM ats.business_units WHERE id = $1::uuid AND tenant_id = $2::uuid AND branch_id = $3::uuid',
          businessUnitId,
          user.tenant_id,
          branchId || null,
        );
        if (!unit.length)
          throw new BadRequestException(
            'Select a business unit belonging to this branch.',
          );
      }
      const scope = {
        ...user,
        branch_id: branchId || null,
        business_unit_id: businessUnitId || null,
      };
      const role = await this.resolveRole(
        tx,
        user.tenant_id,
        identifier.trim(),
        scope,
      );
      const sameRequest =
        user.requested_role === role.id &&
        user.branch_id === scope.branch_id &&
        user.business_unit_id === scope.business_unit_id;
      const version =
        sameRequest && user.role_request_version
          ? user.role_request_version
          : randomUUID();
      const recipients = await this.reviewers(tx, scope, role);
      await tx.$executeRawUnsafe(
        `UPDATE ats.users SET requested_role = $1, role_request_version = $2::uuid, branch_id = $3::uuid,
          business_unit_id = $4::uuid, city = $5::ats."UserCity", updated_at = NOW() WHERE id = $6::uuid AND tenant_id = $7::uuid`,
        role.id,
        version,
        scope.branch_id,
        scope.business_unit_id,
        city === undefined ? user.city : city,
        userId,
        user.tenant_id,
      );
      if (recipients.length)
        await tx.$executeRawUnsafe(
          `INSERT INTO ats.role_request_deliveries (tenant_id, requester_id, recipient_id, request_version, channel)
         SELECT $1::uuid, $2::uuid, recipient_id, $3::uuid, channel
         FROM unnest($4::uuid[]) AS recipients(recipient_id) CROSS JOIN unnest(ARRAY['email', 'in_app']) AS channels(channel)
         ON CONFLICT (requester_id, request_version, recipient_id, channel) DO NOTHING`,
          user.tenant_id,
          userId,
          version,
          recipients.map((r) => r.id),
        );
      return {
        success: true,
        requestVersion: version,
        message: 'Role request submitted for approval.',
        notification: {
          status: recipients.length ? 'queued' : 'no_reviewers',
          recipientCount: recipients.length,
        },
      };
    });
  }

  async review(
    userId: string,
    version: string,
    actor: AuthUser,
  ): Promise<RoleRequestReview> {
    const rows = await this.prisma.$queryRawUnsafe<
      (PendingUser & { branch_name: string | null; unit_name: string | null })[]
    >(
      `SELECT u.id, u.tenant_id, u.email, u.full_name, u.requested_role, u.role_request_version, u.is_approved, u.branch_id, u.business_unit_id,
        b.name AS branch_name, bu.name AS unit_name
       FROM ats.users u LEFT JOIN ats.branches b ON b.id = u.branch_id AND b.tenant_id = u.tenant_id
       LEFT JOIN ats.business_units bu ON bu.id = u.business_unit_id AND bu.tenant_id = u.tenant_id
       WHERE u.id = $1::uuid AND u.tenant_id = $2::uuid`,
      userId,
      actor.tenantId,
    );
    const user = rows[0];
    if (!user || !canReviewRoleRequest(actor, user))
      throw new ForbiddenException(
        'This request is unavailable or outside your approval scope.',
      );
    if (
      user.is_approved ||
      !user.requested_role ||
      user.role_request_version !== version
    )
      throw new ConflictException(
        'This request has already been handled or replaced.',
      );
    const role = await this.resolveRole(
      this.prisma,
      user.tenant_id,
      user.requested_role,
      user,
    );
    if (!canGrantRequestedRole(actor, role, user))
      throw new ForbiddenException(
        'Your current role cannot grant the requested access.',
      );
    return {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      requestedRole: role.name,
      roleId: role.id,
      branchId: user.branch_id || null,
      businessUnitId: user.business_unit_id || null,
      branchName: user.branch_name,
      businessUnitName: user.unit_name,
      requestVersion: version,
    };
  }

  async dispatchPending() {
    if (this.processing) return;
    this.processing = true;
    try {
      const lease = randomUUID();
      const jobs = await this.prisma.$queryRawUnsafe<Delivery[]>(
        `WITH ready AS (
           SELECT id FROM ats.role_request_deliveries WHERE status IN ('pending', 'sending') AND available_at <= NOW()
           ORDER BY available_at, id LIMIT 8 FOR UPDATE SKIP LOCKED
         ) UPDATE ats.role_request_deliveries d SET status = 'sending', lease_id = $1::uuid,
           attempts = attempts + 1, available_at = NOW() + INTERVAL '5 minutes'
         FROM ready WHERE d.id = ready.id RETURNING d.id, d.tenant_id, d.requester_id, d.recipient_id, d.request_version, d.channel, d.attempts, d.lease_id`,
        lease,
      );
      await Promise.allSettled(jobs.map((job) => this.deliver(job)));
    } catch {
      this.logger.warn(
        'Role-request delivery worker could not read pending work. Check database availability and migrations.',
      );
    } finally {
      this.processing = false;
    }
  }

  private async deliver(job: Delivery) {
    try {
      if (job.attempts > 5) return this.finish(job, 'failed');
      const rows = await this.prisma.$queryRawUnsafe<
        (PendingUser & {
          tenant_name: string;
          domain: string;
          branch_name: string;
          unit_name: string;
        })[]
      >(
        `SELECT u.id, u.tenant_id, u.email, u.full_name, u.requested_role, u.role_request_version, u.is_approved, u.branch_id, u.business_unit_id,
          t.name AS tenant_name, t.domain, b.name AS branch_name, bu.name AS unit_name
         FROM ats.users u JOIN ats.tenants t ON t.id = u.tenant_id
         LEFT JOIN ats.branches b ON b.id = u.branch_id AND b.tenant_id = u.tenant_id
         LEFT JOIN ats.business_units bu ON bu.id = u.business_unit_id AND bu.tenant_id = u.tenant_id
         WHERE u.id = $1::uuid AND u.tenant_id = $2::uuid`,
        job.requester_id,
        job.tenant_id,
      );
      const user = rows[0];
      if (
        !user ||
        user.is_approved ||
        !user.requested_role ||
        user.role_request_version !== job.request_version
      )
        return this.finish(job, 'cancelled');
      const role = await this.resolveRole(
        this.prisma,
        user.tenant_id,
        user.requested_role,
        user,
      );
      const recipient = (
        await this.reviewers(this.prisma, user, role, job.recipient_id)
      ).find((r) => r.id === job.recipient_id);
      if (!recipient) return this.finish(job, 'cancelled');
      const query = new URLSearchParams({
        requestId: user.id,
        requestVersion: job.request_version,
        reviewRoleId: recipient.role_id,
      });
      const path = `/auth/role-request?${query}`;
      if (job.channel === 'email') {
        await this.mail.sendRoleRequestEmail({
          tenantId: user.tenant_id,
          to: recipient.email,
          fullName: recipient.full_name,
          requesterName: user.full_name,
          requesterEmail: user.email,
          roleName: role.name,
          branch: user.branch_name,
          unit: user.unit_name,
          tenantName: user.tenant_name,
          subdomain: user.domain,
          reviewPath: path,
        });
      } else {
        const notification = await this.notifications.create(
          user.tenant_id,
          recipient.id,
          {
            type: 'ROLE_REQUEST',
            title: 'New Role Request',
            message: `${user.full_name} requested the ${role.name} role.`,
            data: {
              url: path,
              requestId: user.id,
              requestVersion: job.request_version,
            },
            initiatorId: user.id,
          },
          job.id,
          true,
        );
        if (!notification) throw new Error('Notification was not persisted');
      }
      await this.finish(job, 'accepted');
    } catch {
      this.logger.warn(
        `Role-request ${job.channel} delivery ${job.id} failed (attempt ${job.attempts}).`,
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE ats.role_request_deliveries SET status = $1, available_at = NOW() + ($2::integer * INTERVAL '1 minute'), lease_id = NULL
         WHERE id = $3::uuid AND lease_id = $4::uuid`,
        job.attempts >= 5 ? 'failed' : 'pending',
        Math.min(60, 2 ** job.attempts),
        job.id,
        job.lease_id,
      );
    }
  }

  private async finish(job: Delivery, status: string) {
    await this.prisma.$executeRawUnsafe(
      'UPDATE ats.role_request_deliveries SET status = $1, lease_id = NULL WHERE id = $2::uuid AND lease_id = $3::uuid',
      status,
      job.id,
      job.lease_id,
    );
  }
}
