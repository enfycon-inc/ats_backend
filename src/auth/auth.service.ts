import { Injectable } from '@nestjs/common';

// Sub-services
import { AuthQueryService } from './services/auth-query.service';
import { AuthCoreService } from './services/auth-core.service';
import { AuthUserService } from './services/auth-user.service';
import { AuthTenantService } from './services/auth-tenant.service';
import { AuthRbacService } from './services/auth-rbac.service';
import { AuthKeycloakService } from './services/auth-keycloak.service';
import { AuthInviteService } from './services/auth-invite.service';
import { AuthEmailService } from './services/auth-email.service';

// DTOs
import { LoginDto } from './dtos/login.dto';
import { RegisterDto } from './dtos/register.dto';
import { RegisterTenantDto } from './dtos/register-tenant.dto';
import { InviteUserDto } from './dtos/invite-user.dto';
import { SsoLoginDto } from './dtos/sso-login.dto';
import { AcceptInviteDto } from './dtos/accept-invite.dto';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AuthService — Thin Orchestrator / Delegator
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This class is the **public API** consumed by AuthController and any other
 * module that imports AuthModule.  It does NOT contain any business logic —
 * every method simply delegates to the appropriate specialized sub-service.
 *
 * Sub-service responsibilities:
 *   AuthCoreService     — login, register, refreshToken, JWT decode helpers
 *   AuthUserService     — getProfile, listUsers, updateUser, deleteUser, setActive
 *   AuthTenantService   — registerTenant, approve, listTenants, domains, settings
 *   AuthRbacService     — roles, permissions, seedTenantRoles, assign/unassign
 *   AuthKeycloakService — provisionUser, syncUser, deleteUser in Keycloak
 *   AuthInviteService   — inviteUser, getInvitationDetails, acceptInvite
 *   AuthEmailService    — sendWelcomeEmail, sendMemberCredentialsEmail
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AuthService {
  constructor(
    /** Shared Prisma query helper — also available if other services need raw SQL */
    readonly authQuery: AuthQueryService,
    private readonly coreService: AuthCoreService,
    private readonly userService: AuthUserService,
    private readonly tenantService: AuthTenantService,
    private readonly rbacService: AuthRbacService,
    private readonly keycloakService: AuthKeycloakService,
    private readonly inviteService: AuthInviteService,
    private readonly emailService: AuthEmailService,
  ) {}

  // ─── Backward-compatible query helper (used by guards / other modules) ───────
  async query<T = any>(sql: string, params: any[] = []) {
    return this.authQuery.query<T>(sql, params);
  }

  // ─── JWT decode helpers (read-only — no signing) ────────────────────────────────
  decodeTokenPayload(token: string) { return this.coreService.decodeTokenPayload(token); }
  getRequesterInfoFromToken(authHeader?: string) { return this.coreService.getRequesterInfoFromToken(authHeader); }

  // ─── Core Auth ───────────────────────────────────────────────────────────────
  login(dto: LoginDto) { return this.coreService.login(dto); }
  register(dto: RegisterDto, authHeader?: string) { return this.coreService.register(dto, authHeader); }
  refreshKeycloakToken(refreshToken: string) { return this.coreService.refreshKeycloakToken(refreshToken); }
  ssoLogin(dto: SsoLoginDto) { return this.coreService.ssoLogin(dto); }

  // ─── User Management ─────────────────────────────────────────────────────────
  getProfile(userId: string) { return this.userService.getProfile(userId); }
  listUsers(tenantId: string, scopedBranchId?: string | null) { return this.userService.listUsers(tenantId, scopedBranchId); }
  setUserActive(userId: string, isActive: boolean, requesterId: string) { return this.userService.setUserActive(userId, isActive, requesterId); }
  deleteUser(userId: string, requester: any) { return this.userService.deleteUser(userId, requester); }
  updateUserRoles(userId: string, roles: string[], requesterRoles: string[]) { return this.userService.updateUserRoles(userId, roles, requesterRoles); }
  updateUserDetails(userId: string, dto: any, requester: any) { return this.userService.updateUserDetails(userId, dto, requester); }
  bulkSetJobReviewer(tenantId: string, userIds: string[], reviewerId: string | null) { return this.userService.bulkSetJobReviewer(tenantId, userIds, reviewerId); }

  // ─── Tenant Lifecycle ────────────────────────────────────────────────────────
  registerTenant(dto: RegisterTenantDto) { return this.tenantService.registerTenant(dto); }
  listPendingApprovals() { return this.tenantService.listPendingApprovals(); }
  approveUser(userId: string, market: string, subdomain?: string, userLimit?: number, maxBranches?: number) { return this.tenantService.approveUser(userId, market, subdomain, userLimit, maxBranches); }
  createManualTenant(dto: any) { return this.tenantService.createManualTenant(dto); }
  listTenants() { return this.tenantService.listTenants(); }
  getTenantDetails(tenantId: string) { return this.tenantService.getTenantDetails(tenantId); }
  updateTenantStatus(tenantId: string, status: string) { return this.tenantService.updateTenantStatus(tenantId, status); }
  updateTenantUserLimit(tenantId: string, limit: number) { return this.tenantService.updateTenantUserLimit(tenantId, limit); }
  updateTenantBranchLimit(tenantId: string, limit: number) { return this.tenantService.updateTenantBranchLimit(tenantId, limit); }
  updateTenantMarket(tenantId: string, market: string) { return this.tenantService.updateTenantMarket(tenantId, market); }
  updateTenantSubdomain(tenantId: string, subdomain: string) { return this.tenantService.updateTenantSubdomain(tenantId, subdomain); }
  getTenantDomains(tenantId: string) { return this.tenantService.getTenantDomains(tenantId); }
  addTenantDomain(tenantId: string, domainName: string) { return this.tenantService.addTenantDomain(tenantId, domainName); }
  deleteTenantDomain(tenantId: string, domainId: string) { return this.tenantService.deleteTenantDomain(tenantId, domainId); }
  isDomainRegistered(domainName: string) { return this.tenantService.isDomainRegistered(domainName); }
  updateTenantSettings(tenantId: string, settings: any) { return this.tenantService.updateTenantSettings(tenantId, settings); }
  getTenantAuthPolicy(tenantIdOrSubdomain: string) { return this.tenantService.getTenantAuthPolicy(tenantIdOrSubdomain); }
  updateTenantAuthPolicy(tenantId: string, dto: any) { return this.tenantService.updateTenantAuthPolicy(tenantId, dto); }
  verifyCustomDomain(tenantId: string, domainName: string) { return this.tenantService.verifyCustomDomain(tenantId, domainName); }

  // ─── RBAC ────────────────────────────────────────────────────────────────────
  seedTenantRoles(tenantId: string) { return this.rbacService.seedTenantRoles(tenantId); }
  listRoles(tenantId: string, branchId?: string, includeSystem?: boolean) { return this.rbacService.listRoles(tenantId, branchId, includeSystem); }
  getAssignableRolePool(tenantId: string, branchId?: string) { return this.rbacService.getAssignableRolePool(tenantId, branchId); }
  createCustomRole(tenantId: string, name: string, description: string, permissions: string[], systemRole?: string, branchId?: string, createdById?: string, baseRoleId?: string) {
    return this.rbacService.createCustomRole(tenantId, name, description, permissions, systemRole, branchId, createdById, baseRoleId);
  }
  updateCustomRole(tenantId: string, roleId: string, body: any, userId?: string) { return this.rbacService.updateCustomRole(tenantId, roleId, body, userId); }
  updateRolePermissions(tenantId: string, roleId: string, permissions: string[]) { return this.rbacService.updateRolePermissions(tenantId, roleId, permissions); }
  deleteCustomRole(tenantId: string, roleId: string, targetRoleId?: string) { return this.rbacService.deleteCustomRole(tenantId, roleId, targetRoleId); }
  assignUserRoles(tenantId: string, userId: string, roleIds: string[], requesterRoles: string[], append?: boolean) { return this.rbacService.assignUserRoles(tenantId, userId, roleIds, requesterRoles, append); }
  batchAssignUsersToRole(tenantId: string, roleId: string, userIds: string[], requesterRoles: string[]) { return this.rbacService.batchAssignUsersToRole(tenantId, roleId, userIds, requesterRoles); }
  unassignUserFromRole(tenantId: string, roleId: string, userId: string) { return this.rbacService.unassignUserFromRole(tenantId, roleId, userId); }
  listAllPermissions() { return this.rbacService.listAllPermissions(); }
  checkSeatLimit(tenantId: string) { return this.rbacService.checkSeatLimit(tenantId); }
  verifyLastAdminProtection(tenantId: string, targetUserId: string, action: 'demote' | 'deactivate' | 'delete') { return this.rbacService.verifyLastAdminProtection(tenantId, targetUserId, action); }

  // ─── Keycloak ────────────────────────────────────────────────────────────────
  provisionUserInKeycloak(data: { email: string; password?: string; fullName?: string; tenantId?: string }) { return this.keycloakService.provisionUserInKeycloak(data); }
  syncKeycloakUser(data: { keycloakId: string; email: string; fullName: string; roles: string[] }) { return this.keycloakService.syncKeycloakUser(data); }
  deleteKeycloakUser(email: string) { return this.keycloakService.deleteKeycloakUser(email); }
  getKeycloakAdminToken() { return this.keycloakService.getKeycloakAdminToken(); }

  // ─── Invitations ─────────────────────────────────────────────────────────────
  inviteUser(dto: InviteUserDto, authHeader?: string) {
    return this.coreService.getRequesterInfoFromToken(authHeader).then((requester) =>
      this.inviteService.inviteUser(dto, requester)
    );
  }
  getInvitationDetails(token: string) { return this.inviteService.getInvitationDetails(token); }
  acceptInvite(dto: AcceptInviteDto) { return this.inviteService.acceptInvite(dto); }

  // ─── Email ───────────────────────────────────────────────────────────────────
  sendWelcomeEmail(options: any) { return this.emailService.sendWelcomeEmail(options); }
  sendMemberCredentialsEmail(options: any) { return this.emailService.sendMemberCredentialsEmail(options); }
}
