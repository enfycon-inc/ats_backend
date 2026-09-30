import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AuthQueryService } from './auth-query.service';
import { AuthKeycloakService } from './auth-keycloak.service';
import { AuthEmailService } from './auth-email.service';
import { AuthTenantService } from './auth-tenant.service';
import { AuthRbacService } from './auth-rbac.service';
import type { AuthUser } from '../interfaces/auth-user.interface';
import { validateBranchAccess } from '../utils/branch-scoping';


const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID as string;

/**
 * AuthInviteService — manages the full invitation lifecycle:
 * inviting users, viewing invitation details, and accepting invitations
 * (setting a password via Keycloak and activating the user record).
 */
@Injectable()
export class AuthInviteService {
  private readonly logger = new Logger(AuthInviteService.name);

  constructor(
    private readonly authQuery: AuthQueryService,
    private readonly keycloakService: AuthKeycloakService,
    private readonly emailService: AuthEmailService,
    private readonly tenantService: AuthTenantService,
    private readonly rbacService: AuthRbacService,
  ) {}

  async inviteUser(dto: {
    email: string;
    fullName: string;
    systemRole?: string;
    roleId?: string;
    branchId?: string;
    podId?: string;
    sendEmailInvite?: boolean;
  }, requester: { isAdmin: boolean; roles: string[]; tenantId: string | null } & Omit<Partial<AuthUser>, 'tenantId'>) {
    if (!requester.isAdmin && !requester.roles.includes('BRANCH_ADMIN')) {
      throw new BadRequestException('Only Administrators can invite new users.');
    }

    const tenantId = requester.tenantId || DEFAULT_TENANT_ID;
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    const fullName = (dto.fullName || '').trim();

    if (!cleanEmail || !fullName) throw new BadRequestException('Email and full name are required.');

    const emailParts = cleanEmail.split('@');
    if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
      throw new BadRequestException('Invalid email address format.');
    }

    const existing = await this.authQuery.query(
      'SELECT id, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1',
        [cleanEmail]
    );
    if (existing.rows.length > 0) throw new BadRequestException('This email is already registered in the system. An email address cannot belong to multiple workspaces.');

    await this.rbacService.checkSeatLimit(tenantId);

    // Branch isolation: branch admins can only invite users into their assigned branches
    if (dto.branchId && requester.permissions) {
      const perms: string[] = Array.isArray(requester.permissions) ? requester.permissions : [];
      if (perms.includes('branch_admin:manage') && !perms.includes('tenant:settings')) {
        validateBranchAccess(requester as AuthUser, dto.branchId, 'invite users to branch');
      }
    }

    const policy = await this.tenantService.getTenantAuthPolicy(tenantId);

    const emailDomain = emailParts[1].toLowerCase();
    const isPersonalDomain = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com'].includes(emailDomain);
    if (policy.allowPersonalEmails === false && isPersonalDomain) {
      throw new BadRequestException('Personal email addresses are not permitted for this organization.');
    }
    if (policy.allowedEmailDomains && policy.allowedEmailDomains.length > 0) {
      if (!policy.allowedEmailDomains.map((d: string) => d.toLowerCase()).includes(emailDomain)) {
        throw new BadRequestException(`Invitations for @${emailDomain} domain are not allowed by organization settings.`);
      }
    }

    const systemRole = (dto.systemRole || 'RECRUITER').toUpperCase();
    const sysRoleRes = await this.authQuery.query('SELECT id FROM system_roles WHERE system_key = $1 LIMIT 1', [systemRole]);
    const systemRoleId = sysRoleRes.rows.length > 0 ? (sysRoleRes.rows[0] as any).id : null;

    let roleId = dto.roleId || null;
    if (!roleId) {
      const defaultRoleRes = await this.authQuery.query(
        `SELECT cr.id FROM custom_roles cr
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE cr.tenant_id = $1 AND (sr.system_key = $2 OR cr.name = $2) LIMIT 1`,
        [tenantId, systemRole]
      );
      if (defaultRoleRes.rows.length > 0) roleId = (defaultRoleRes.rows[0] as any).id;
    }

    const firstName = fullName.split(/\s+/)[0] || '';
    const lastName = fullName.split(/\s+/).slice(1).join(' ') || '';
    const assignedRoleIds = roleId ? [roleId] : [];
    const insertUserRes = await this.authQuery.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, role_id, assigned_role_ids, branch_id, pod_id, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, true, true)
       RETURNING id, email, first_name, last_name, full_name, created_at`,
      [tenantId, cleanEmail, firstName, lastName, fullName, roleId, assignedRoleIds, dto.branchId || null, dto.podId || null]
    );
    const newUser: any = insertUserRes.rows[0];

    const invitationToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.authQuery.query(
      `INSERT INTO user_invitations (tenant_id, email, full_name, role_id, system_role_id, branch_id, pod_id, invitation_token, token_expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         invitation_token = EXCLUDED.invitation_token,
         token_expires_at = EXCLUDED.token_expires_at,
         is_accepted = FALSE`,
      [tenantId, cleanEmail, fullName, roleId, systemRoleId, dto.branchId || null, dto.podId || null, invitationToken, expiresAt, requester.isAdmin ? 'Admin' : 'BranchAdmin']
    );

    const tenantRes = await this.authQuery.query('SELECT name, domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    const tenantName = (tenantRes.rows[0] as any)?.name || 'Enfycon Workspace';
    const tenantDomain = (tenantRes.rows[0] as any)?.domain || '';

    if (dto.sendEmailInvite !== false) {
      this.emailService.sendWelcomeEmail({
        to: cleanEmail,
        fullName,
        tenantName,
        subdomain: tenantDomain,
        invitationToken,
        roleName: systemRole,
      }).catch((err: any) => {
        this.logger.warn(`Failed to dispatch welcome email to ${cleanEmail}: ${err.message}`);
      });
    }

    return { success: true, message: 'User invited successfully.', user: newUser, invitationToken, expiresAt };
  }

  async getInvitationDetails(token: string) {
    if (!token) throw new BadRequestException('Token is required.');
    const res = await this.authQuery.query(
      `SELECT ui.id, ui.email, ui.full_name, sr.system_key as system_role, ui.token_expires_at, ui.is_accepted,
              t.name as tenant_name, t.domain as tenant_domain
       FROM user_invitations ui
       JOIN tenants t ON ui.tenant_id = t.id
       LEFT JOIN system_roles sr ON ui.system_role_id = sr.id
       WHERE ui.invitation_token = $1 LIMIT 1`,
      [token]
    );
    if (res.rows.length === 0) throw new NotFoundException('Invitation token is invalid or does not exist.');
    const row: any = res.rows[0];
    const isExpired = new Date(row.token_expires_at).getTime() < Date.now();
    return {
      email: row.email,
      fullName: row.full_name,
      systemRole: row.system_role,
      tenantName: row.tenant_name,
      tenantDomain: row.tenant_domain,
      isExpired,
      isAccepted: row.is_accepted,
    };
  }

  async acceptInvite(dto: { token: string; password: string }) {
    if (!dto.token || !dto.password) throw new BadRequestException('Token and password are required.');
    if (dto.password.length < 8) throw new BadRequestException('Password must be at least 8 characters long.');

    const res = await this.authQuery.query(
      `SELECT ui.*, t.domain as tenant_domain FROM user_invitations ui
       JOIN tenants t ON ui.tenant_id = t.id
       WHERE ui.invitation_token = $1 LIMIT 1`,
      [dto.token]
    );
    if (res.rows.length === 0) throw new NotFoundException('Invitation token is invalid.');
    const invite: any = res.rows[0];
    if (new Date(invite.token_expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Invitation has expired. Please contact your administrator for a new invite.');
    }

    await this.authQuery.query(
      `UPDATE users SET is_active = true, is_approved = true, updated_at = NOW()
       WHERE LOWER(email) = LOWER($1) AND tenant_id = $2`,
      [invite.email, invite.tenant_id]
    );

    await this.keycloakService.provisionUserInKeycloak({
      email: invite.email,
      password: dto.password,
      fullName: invite.full_name,
      tenantId: invite.tenant_id,
    });

    await this.authQuery.query(`UPDATE user_invitations SET is_accepted = true WHERE id = $1`, [invite.id]);

    return {
      success: true,
      message: 'Password created successfully! You can now log in.',
      email: invite.email,
      subdomain: invite.tenant_domain,
    };
  }
}
