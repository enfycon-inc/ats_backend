import { rejectManualPodLeadRoles } from './pod-lead-role-policy';
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
import { isTenantAdmin } from '../utils/branch-scoping';
import { USER_CITY_VALUES, type UserCity } from '../user-city-contract';


const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID as string;

const normalizeImportName = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

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
    firstName?: string;
    lastName?: string;
    systemRole?: string;
    roleId?: string;
    roleIds?: string[];
    branchId?: string;
    businessUnitId?: string;
    podId?: string;
    city?: UserCity | null;
    sendEmailInvite?: boolean;
  }, requester: { isAdmin: boolean; roles: string[]; tenantId: string | null } & Omit<Partial<AuthUser>, 'tenantId'>) {
    if (!requester.isAdmin && !requester.roles.includes('BRANCH_ADMIN') && !requester.permissions?.includes('user:manage')) {
      throw new BadRequestException('Only Administrators can invite new users.');
    }

    const tenantId = requester.tenantId || DEFAULT_TENANT_ID;
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const [field, value] of Object.entries({ tenantId, roleId: dto.roleId, branchId: dto.branchId, businessUnitId: dto.businessUnitId, podId: dto.podId })) {
      if (value && (typeof value !== 'string' || !validId.test(value))) throw new BadRequestException(`${field} must be a valid ID.`);
    }
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    const fullName = (dto.fullName || `${dto.firstName || ''} ${dto.lastName || ''}`).trim().replace(/\s+/g, ' ');

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

    if (dto.businessUnitId) {
      const unit = await this.authQuery.query(
        'SELECT id FROM business_units WHERE id = $1::uuid AND tenant_id = $2::uuid AND branch_id = $3::uuid LIMIT 1',
        [dto.businessUnitId, tenantId, dto.branchId || null],
      );
      if (!unit.rows.length) throw new BadRequestException('Select a unit in the chosen workspace and branch.');
    }

    await rejectManualPodLeadRoles(this.authQuery, tenantId, [...(dto.roleIds || []), ...(dto.roleId ? [dto.roleId] : []), dto.systemRole || 'RECRUITER']);
    const systemRole = (dto.systemRole || 'RECRUITER').toUpperCase();
    const requestedRoleIds = Array.from(new Set(dto.roleIds?.length ? dto.roleIds : dto.roleId ? [dto.roleId] : []));
    let roleId = requestedRoleIds[0] || null;
    let roleNames: string[] = [];
    let systemRoleId: string | null = null;
    if (!roleId) {
      const defaultRoleRes = await this.authQuery.query(
        `SELECT cr.id, cr.name, sr.id AS system_role_id FROM custom_roles cr
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE cr.tenant_id = $1 AND (sr.system_key = $2 OR cr.name = $2) LIMIT 1`,
        [tenantId, systemRole]
      );
      if (defaultRoleRes.rows.length > 0) {
        roleId = (defaultRoleRes.rows[0] as any).id;
        roleNames = [(defaultRoleRes.rows[0] as any).name];
        systemRoleId = (defaultRoleRes.rows[0] as any).system_role_id || null;
      }
    } else {
      const selectedRoles = await this.authQuery.query(
        `SELECT cr.id, cr.name, cr.branch_id, cr.business_unit_id, sr.id AS system_role_id
         FROM custom_roles cr LEFT JOIN system_roles sr ON sr.id = cr.system_role_id
         WHERE cr.id = ANY($1::uuid[]) AND cr.tenant_id = $2::uuid`,
        [requestedRoleIds, tenantId],
      );
      if (selectedRoles.rows.length !== requestedRoleIds.length) throw new BadRequestException('Select valid roles in this workspace.');
      for (const selected of selectedRoles.rows as any[]) {
        if (selected.branch_id && selected.branch_id !== dto.branchId) throw new BadRequestException('A selected role is outside the chosen branch.');
        if (selected.business_unit_id && selected.business_unit_id !== dto.businessUnitId) throw new BadRequestException('A selected role is outside the chosen unit.');
      }
      const byId = new Map((selectedRoles.rows as any[]).map((selected) => [selected.id, selected]));
      roleNames = requestedRoleIds.map((id) => byId.get(id)?.name).filter(Boolean) as string[];
      systemRoleId = byId.get(roleId)?.system_role_id || null;
    }

    const firstName = (dto.firstName || fullName.split(/\s+/)[0] || '').trim();
    const lastName = (dto.lastName || fullName.split(/\s+/).slice(1).join(' ') || '').trim();
    const assignedRoleIds = requestedRoleIds.length ? requestedRoleIds : roleId ? [roleId] : [];
    const insertUserRes = await this.authQuery.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, role_id, assigned_role_ids, branch_id, business_unit_id, city, pod_id, is_active, is_approved)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid[], $8::uuid, $9::uuid, $10::ats."UserCity", $11::uuid, true, true)
       RETURNING id, email, first_name, last_name, full_name, created_at`,
      [tenantId, cleanEmail, firstName, lastName, fullName, roleId, assignedRoleIds, dto.branchId || null, dto.businessUnitId || null, dto.city || null, dto.podId || null]
    );
    const newUser: any = insertUserRes.rows[0];

    const invitationToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await this.authQuery.query(
        `INSERT INTO user_invitations (tenant_id, email, full_name, role_id, system_role_id, branch_id, pod_id, invitation_token, token_expires_at, created_by)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::uuid)
         ON CONFLICT (tenant_id, email) DO UPDATE SET
           invitation_token = EXCLUDED.invitation_token,
           token_expires_at = EXCLUDED.token_expires_at,
           is_accepted = FALSE`,
        [tenantId, cleanEmail, fullName, roleId, systemRoleId, dto.branchId || null, dto.podId || null, invitationToken, expiresAt, requester.dbId || null]
      );
    } catch (error) {
      await this.authQuery.query('DELETE FROM users WHERE id = $1::uuid AND tenant_id = $2::uuid', [newUser.id, tenantId]).catch(() => undefined);
      throw error;
    }

    const tenantRes = await this.authQuery.query('SELECT name, domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    const tenantName = (tenantRes.rows[0] as any)?.name || 'Enfycon Workspace';
    const tenantDomain = (tenantRes.rows[0] as any)?.domain || '';

    let emailNotification: { status: 'accepted' | 'failed' | 'disabled'; message?: string } = { status: 'disabled' };
    if (dto.sendEmailInvite !== false) {
      try {
        await this.emailService.sendWelcomeEmail({ tenantId, to: cleanEmail, fullName, tenantName,
          subdomain: tenantDomain, invitationToken, roleName: roleNames.join(', ') || undefined });
        emailNotification = { status: 'accepted' };
      } catch {
        this.logger.warn('Invitation saved, but invitation email was not accepted.');
        emailNotification = { status: 'failed', message: 'Invitation saved, but email was not accepted. Check workspace email settings.' };
      }
    }

    return { success: true, emailNotification, message: 'User invited successfully.', user: newUser, invitationToken, expiresAt };
  }

  private assertBulkImportScope(requester: AuthUser) {
    if (!requester?.tenantId || !requester.permissions?.includes('user:manage')) {
      throw new ForbiddenException('User management permission is required to import users.');
    }
    if (isTenantAdmin(requester)) return { branchId: null as string | null, businessUnitId: null as string | null };
    if (!requester.branchId) throw new ForbiddenException('A branch assignment is required to import users.');
    const branchManager = requester.permissions.includes('branch_admin:manage') || requester.systemRole === 'DELIVERY_HEAD';
    const unitManager = requester.permissions.includes('unit_admin:manage') && requester.systemRole !== 'DELIVERY_HEAD';
    if (unitManager && !requester.businessUnitId) throw new ForbiddenException('A business unit assignment is required to import users.');
    if (!branchManager && !unitManager && !requester.businessUnitId) {
      throw new ForbiddenException('A business unit assignment is required to import users.');
    }
    return { branchId: requester.branchId, businessUnitId: branchManager ? null : requester.businessUnitId || null };
  }

  async validateBulkUsers(rows: any[], requester: AuthUser) {
    const scope = this.assertBulkImportScope(requester);
    rows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.example || '').trim().toUpperCase() !== 'YES')
      : rows;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) {
      throw new BadRequestException('Upload between 1 and 100 user rows per import. Example rows marked YES are ignored.');
    }
    const tenantId = requester.tenantId;
    const policy = await this.tenantService.getTenantAuthPolicy(tenantId);
    const [branchesResult, unitsResult, rolesResult] = await Promise.all([
      this.authQuery.query('SELECT id, name FROM branches WHERE tenant_id = $1::uuid', [tenantId]),
      this.authQuery.query('SELECT id, name, branch_id FROM business_units WHERE tenant_id = $1::uuid', [tenantId]),
      this.authQuery.query(
        `SELECT cr.id, cr.name, cr.branch_id, cr.business_unit_id, sr.system_key
         FROM custom_roles cr LEFT JOIN system_roles sr ON sr.id = cr.system_role_id
         WHERE cr.tenant_id = $1::uuid`, [tenantId]),
    ]);
    const branches = branchesResult.rows as any[];
    const units = unitsResult.rows as any[];
    const roles = rolesResult.rows as any[];
    const emails = rows.map((row) => String(row.email || '').trim().toLowerCase()).filter(Boolean);
    const existingResult = emails.length
      ? await this.authQuery.query('SELECT LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1::text[])', [emails])
      : { rows: [] };
    const existingEmails = new Set((existingResult.rows as any[]).map((row) => row.email));
    const seenEmails = new Set<string>();
    const personalDomains = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com'];
    const emailPolicyError = (email: string) => {
      const domain = email.split('@')[1]?.toLowerCase() || '';
      if (policy.allowPersonalEmails === false && personalDomains.includes(domain)) return 'Personal email addresses are not allowed by this workspace.';
      if (policy.allowedEmailDomains?.length && !policy.allowedEmailDomains.map((item: string) => item.toLowerCase()).includes(domain)) return `Email domain @${domain} is not allowed by this workspace.`;
      return '';
    };
    const matchName = (value: string, options: any[], field: string, resolveAmbiguousExact?: (matches: any[]) => any | null) => {
      const normalized = normalizeImportName(value);
      const exact = options.filter((option) => normalizeImportName(option.name) === normalized);
      if (exact.length === 1) return { match: exact[0], error: '', suggestions: [] as string[] };
      if (exact.length > 1 && resolveAmbiguousExact) {
        const resolved = resolveAmbiguousExact(exact);
        if (resolved) return { match: resolved, error: '', suggestions: [] as string[] };
      }
      const choices = Array.from(new Set(options.map((option) => String(option.name))));
      const near = choices.map((candidate) => ({ candidate, distance: editDistance(normalized, normalizeImportName(candidate)) }))
        .filter((item) => normalized && item.distance <= Math.max(2, Math.floor(normalized.length * 0.22)))
        .sort((a, b) => a.distance - b.distance);
      const suggestions = !exact.length && near.length && (near.length === 1 || near[0].distance < near[1].distance) ? [near[0].candidate] : [];
      return { match: null, error: exact.length > 1 ? `${field} name is ambiguous; use a more specific value.` : `${field} was not found.`, suggestions };
    };
    return rows.map((rawInput, index) => {
      const input = rawInput || {};
      const errors: string[] = [];
      const suggestions: Record<string, string[]> = {};
      const legacyName = String(input.fullName || input.name || '').trim().replace(/\s+/g, ' ');
      const firstName = String(input.firstName || legacyName.split(/\s+/)[0] || '').trim().replace(/\s+/g, ' ');
      const lastName = String(input.lastName || legacyName.split(/\s+/).slice(1).join(' ') || '').trim().replace(/\s+/g, ' ');
      const fullName = `${firstName} ${lastName}`.trim();
      const email = String(input.email || '').trim().toLowerCase();
      if (!firstName) errors.push('First name is required.');
      if (!lastName) errors.push('Last name is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
      if (email) {
        if (seenEmails.has(email)) errors.push('This email appears more than once in the file.');
        seenEmails.add(email);
        if (existingEmails.has(email)) errors.push('This email is already registered in the workspace.');
        const policyError = emailPolicyError(email);
        if (policyError) errors.push(policyError);
      }
      const branchMatch = matchName(String(input.branch || ''), branches.filter((branch) => !scope.branchId || branch.id === scope.branchId), 'Branch');
      if (!branchMatch.match) {
        errors.push(branchMatch.error || 'Branch is required.');
        if (branchMatch.suggestions.length) suggestions.branch = branchMatch.suggestions;
      }
      const branchId = branchMatch.match?.id;
      const unitMatch = matchName(String(input.unit || input.businessUnit || ''), units.filter((unit) =>
        (!scope.branchId || unit.branch_id === scope.branchId) && (!branchId || unit.branch_id === branchId) &&
        (!scope.businessUnitId || unit.id === scope.businessUnitId)), 'Unit');
      if (!unitMatch.match) {
        errors.push(unitMatch.error || 'Unit is required.');
        if (unitMatch.suggestions.length) suggestions.unit = unitMatch.suggestions;
      }
      const cityInput = String(input.city || '').trim().toUpperCase();
      const city = cityInput || null;
      if (city && !USER_CITY_VALUES.includes(city as UserCity)) errors.push(`City must be one of: ${USER_CITY_VALUES.join(', ')}.`);
      const roleNames = String(input.roles || input.role || '').split(';').map((role) => role.trim()).filter(Boolean);
      if (!roleNames.length) errors.push('At least one role is required.');
      const resolvedRoles: any[] = [];
      if (branchId && unitMatch.match) {
        for (const roleName of roleNames) {
          const eligibleRoles = roles.filter((role) => {
            if ((role.branch_id && role.branch_id !== branchId) ||
              (role.business_unit_id && role.business_unit_id !== unitMatch.match.id)) return false;
            const roleKey = String(role.system_key || role.name).trim().toUpperCase().replace(/[\s-]+/g, '_');
            if (['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'UNIT_ADMIN'].includes(roleKey)) {
              return role.business_unit_id === unitMatch.match.id;
            }
            if (roleKey === 'BRANCH_ADMIN') {
              return role.branch_id === branchId && !role.business_unit_id;
            }
            if (roleKey === 'TENANT_ADMIN') {
              return !role.branch_id && !role.business_unit_id;
            }
            return true;
          });
          const hasExactName = (candidate: any) => normalizeImportName(candidate.name) === normalizeImportName(roleName);
          const matchingRoles = roles.filter(hasExactName);
          const matchingEligibleRoles = eligibleRoles.filter(hasExactName);
          if (matchingRoles.length && !matchingEligibleRoles.length) {
            const sample = matchingRoles[0];
            const roleKey = String(sample.system_key || sample.name).trim().toUpperCase().replace(/[\s-]+/g, '_');
            const expectedScope = ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'UNIT_ADMIN'].includes(roleKey)
              ? 'the selected unit'
              : roleKey === 'BRANCH_ADMIN' ? 'the selected branch' : roleKey === 'TENANT_ADMIN' ? 'tenant-wide' : 'the selected branch or unit';
            errors.push(`Role "${roleName}" must be assigned at ${expectedScope} scope.`);
            continue;
          }
          const roleMatch = matchName(roleName, eligibleRoles, 'Role', (matches) => {
            const scopeRank = (role: any) => {
              const roleKey = String(role.system_key || role.name).trim().toUpperCase().replace(/[\s-]+/g, '_');
              if (['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'UNIT_ADMIN'].includes(roleKey)) return 3;
              if (roleKey === 'BRANCH_ADMIN') return 2;
              if (roleKey === 'TENANT_ADMIN') return 1;
              return role.business_unit_id === unitMatch.match.id ? 2 : role.branch_id === branchId ? 1 : 0;
            };
            const bestRank = Math.max(...matches.map(scopeRank));
            const bestMatches = matches.filter((role) => scopeRank(role) === bestRank);
            return bestMatches.length === 1 ? bestMatches[0] : null;
          });
          if (!roleMatch.match) {
            errors.push(roleMatch.error || `Role "${roleName}" was not found for this branch and unit.`);
            if (roleMatch.suggestions.length) suggestions[roleName] = roleMatch.suggestions;
            continue;
          }
          const selected = roleMatch.match;
          if (selected.system_key === 'POD_LEAD') errors.push('Pod leadership is assigned only through Recruitment Pods.');
          if (selected.system_key === 'SUPER_ADMIN' || selected.name.toUpperCase() === 'SUPER_ADMIN') errors.push('SUPER_ADMIN cannot be assigned through user import.');
          if ((selected.system_key === 'TENANT_ADMIN' || selected.name.toUpperCase() === 'TENANT_ADMIN') && !isTenantAdmin(requester)) errors.push('Only a tenant administrator can assign the Tenant Admin role.');
          resolvedRoles.push({ id: selected.id, name: selected.name });
        }
      }
      return {
        row: index + 2,
        input,
        normalized: { firstName, lastName, fullName, email, branchId, businessUnitId: unitMatch.match?.id || null,
          city: city as UserCity | null, roleIds: resolvedRoles.map((role) => role.id), roleNames: resolvedRoles.map((role) => role.name) },
        status: errors.length ? 'invalid' : 'ready',
        errors: Array.from(new Set(errors)),
        suggestions,
      };
    });
  }

  async importUsers(rows: any[], requester: AuthUser) {
    const validation = await this.validateBulkUsers(rows, requester);
    const results: Array<{ row: number; email: string; status: 'skipped' | 'created' | 'failed'; errors?: string[]; emailNotification?: any }> = [];
    for (const row of validation) {
      if (row.status !== 'ready') {
        results.push({ row: row.row, email: row.normalized.email, status: 'skipped', errors: row.errors });
        continue;
      }
      try {
        const created = await this.inviteUser({ email: row.normalized.email, fullName: row.normalized.fullName,
          firstName: row.normalized.firstName, lastName: row.normalized.lastName,
          roleIds: row.normalized.roleIds, branchId: row.normalized.branchId,
          businessUnitId: row.normalized.businessUnitId, city: row.normalized.city, sendEmailInvite: true },
        { ...requester, isAdmin: true });
        results.push({ row: row.row, email: row.normalized.email, status: 'created', emailNotification: created.emailNotification });
      } catch (error: any) {
        results.push({ row: row.row, email: row.normalized.email, status: 'failed', errors: [error?.message || 'Could not create this user.'] });
      }
    }
    return { total: results.length, created: results.filter((item) => item.status === 'created').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
      failed: results.filter((item) => item.status === 'failed').length, results };
  }

  async getInvitationDetails(token: string) {
    if (!token) throw new BadRequestException('Token is required.');
    const res = await this.authQuery.query(
      `SELECT ui.id, ui.email, ui.full_name, ui.token_expires_at, ui.is_accepted,
              t.name as tenant_name, t.domain as tenant_domain,
              COALESCE(tas.allow_password_login, true) AS allow_password_login,
              COALESCE(tas.allow_microsoft_sso, true) AS allow_microsoft_sso,
              COALESCE(tas.allow_google_sso, true) AS allow_google_sso
       FROM user_invitations ui
       JOIN tenants t ON ui.tenant_id = t.id
       LEFT JOIN tenant_auth_settings tas ON tas.tenant_id = ui.tenant_id
       WHERE ui.invitation_token = $1 LIMIT 1`,
      [token]
    );
    if (res.rows.length === 0) throw new NotFoundException('Invitation token is invalid or does not exist.');
    const row: any = res.rows[0];
    const isExpired = new Date(row.token_expires_at).getTime() < Date.now();
    return {
      email: row.email,
      fullName: row.full_name,
      tenantName: row.tenant_name,
      tenantDomain: row.tenant_domain,
      allowPasswordLogin: row.allow_password_login ?? true,
      allowMicrosoftSso: row.allow_microsoft_sso ?? true,
      allowGoogleSso: row.allow_google_sso ?? true,
      isExpired,
      isAccepted: row.is_accepted,
    };
  }

  async acceptInvite(dto: { token: string; password: string }) {
    if (!dto.token || !dto.password) throw new BadRequestException('Token and password are required.');
    if (dto.password.length < 8) throw new BadRequestException('Password must be at least 8 characters long.');

    const res = await this.authQuery.query(
      `SELECT ui.*, t.domain as tenant_domain,
              COALESCE(tas.allow_password_login, true) AS allow_password_login
       FROM user_invitations ui
       JOIN tenants t ON ui.tenant_id = t.id
       LEFT JOIN tenant_auth_settings tas ON tas.tenant_id = ui.tenant_id
       WHERE ui.invitation_token = $1 LIMIT 1`,
      [dto.token]
    );
    if (res.rows.length === 0) throw new NotFoundException('Invitation token is invalid.');
    const invite: any = res.rows[0];
    if (new Date(invite.token_expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Invitation has expired. Please contact your administrator for a new invite.');
    }
    if (!invite.allow_password_login) {
      throw new ForbiddenException('Password sign-in is disabled for this tenant. Use an enabled SSO provider or contact your administrator.');
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
