import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dtos/login.dto';
import { RegisterDto } from './dtos/register.dto';
import { RegisterTenantDto } from './dtos/register-tenant.dto';
import { InviteUserDto } from './dtos/invite-user.dto';
import { SsoLoginDto } from './dtos/sso-login.dto';
import { AcceptInviteDto } from './dtos/accept-invite.dto';
import { AddCustomDomainDto, VerifyCustomDomainDto } from './dtos/custom-domain.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { RequirePermissions } from './decorators/permissions.decorator';
import { PermissionsGuard } from './guards/permissions.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './interfaces/auth-user.interface';
import { resolveTenantId } from './utils/tenant-resolver';
import { AuditService } from '../audit/audit.service';

@ApiTags('Auth & Identity')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  // ─── POST /api/auth/login ───────────────────────────────────
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login — get access token',
    description: `
Validates email + password and returns a signed JWT access token.

**Mock mode** (AUTH_PROVIDER=mock):
- Credentials are validated against the local PostgreSQL \`users\` table.
- Returns a real signed JWT with 8-hour expiry.

**Keycloak mode** (AUTH_PROVIDER=keycloak):
- Authenticates against Keycloak OIDC server via Direct Access Grant / Password grant.
    `.trim(),
  })
  @ApiResponse({ status: 200, description: 'Login successful — returns JWT access token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ─── POST /api/auth/refresh ────────────────────────────────
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh Keycloak / JWT access token',
    description: 'Exchanges a valid refresh_token for a new access_token.',
  })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token.' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshKeycloakToken(refreshToken);
  }

  // ─── POST /api/auth/register ────────────────────────────────
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register new user account',
    description:
      'Creates a new user in the `users` table with a hashed password and assigned ATS role. ' +
      'In production (Keycloak mode), user creation is managed inside Keycloak; this endpoint ' +
      'is used for local/development user management only.',
  })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  @ApiResponse({ status: 400, description: 'Invalid role or missing fields.' })
  async register(
    @Body() dto: RegisterDto,
    @Headers('authorization') authHeader?: string,
  ) {
    return this.authService.register(dto, authHeader);
  }

  // ─── POST /api/auth/register-tenant ─────────────────────────
  @Post('register-tenant')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new company tenant (SaaS self-signup)',
    description:
      'Public endpoint. Creates a new isolated tenant workspace and the first ADMIN user for that company. ' +
      'The user account is created with is_approved=false and must be approved by the Enfycon platform admin. ' +
      'The subdomain chosen becomes the company\'s workspace URL: subdomain.enfycon.com',
  })
  @ApiResponse({ status: 201, description: 'Tenant and admin user created, pending approval.' })
  @ApiResponse({ status: 409, description: 'Subdomain or email already taken.' })
  @ApiResponse({ status: 400, description: 'Invalid subdomain format.' })
  async registerTenant(@Body() dto: RegisterTenantDto) {
    return this.authService.registerTenant(dto);
  }

  // ─── GET /api/auth/me ───────────────────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'Tenant UUID (optional in dev — defaults to primary tenant)',
    required: false,
  })
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the authenticated user\'s profile from the database. ' +
      'Works in both mock and Keycloak mode.',
  })
  @ApiResponse({ status: 200, description: 'User profile returned.' })
  @ApiResponse({ status: 401, description: 'Token missing or invalid.' })
  async getMe(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user.dbId);
  }

  // ─── GET /api/auth/profile/:id ──────────────────────────────
  // Alias route — frontend calls /api/auth/profile/{userId} to fetch the
  // authenticated user's own profile. The :id param is accepted but we
  // always return the CALLER's profile (enforced by JwtAuthGuard) to prevent
  // privilege escalation. Admins wishing to query other users use /api/auth/users.
  @Get('profile/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user profile by ID (caller must own the ID)',
    description: 'Returns the authenticated user\'s profile. The :id in the URL must match the authenticated user\'s ID.',
  })
  @ApiResponse({ status: 200, description: 'User profile returned.' })
  @ApiResponse({ status: 401, description: 'Token missing or invalid.' })
  async getProfileById(@CurrentUser() user: AuthUser) {
    // Always return the authenticated caller's own profile
    return this.authService.getProfile(user.dbId);
  }

  // ─── GET /api/auth/users ────────────────────────────────────
  @Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all users in the tenant',
    description: 'Returns all registered users scoped to the active tenant.',
  })
  @ApiResponse({ status: 200, description: 'User list returned.' })
  @ApiResponse({ status: 403, description: 'Insufficient role permissions.' })
  async listUsers(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantHeader?: string,
  ) {
    const tenantId = resolveTenantId(user, tenantHeader);
    return this.authService.listUsers(tenantId);
  }

  // ─── GET /api/auth/tenant-policy ───────────────────────────
  @Get('tenant-policy')
  @ApiOperation({
    summary: 'Get tenant authentication policy (Public/Dynamic)',
    description: 'Returns permitted login methods (Password, Microsoft SSO, Google SSO) for a tenant by ID or subdomain.',
  })
  async getTenantPolicy(
    @Query('tenantId') tenantIdQuery?: string,
    @Query('subdomain') subdomainQuery?: string,
  ) {
    const target = tenantIdQuery || subdomainQuery || 'default';
    return this.authService.getTenantAuthPolicy(target);
  }

  // ─── PATCH /api/auth/tenant-policy ──────────────────────────
  @Patch('tenant-policy')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant authentication policy [ADMIN only]',
    description: 'Allows Tenant Admin to toggle password login, Microsoft/Google SSO, and domain restrictions.',
  })
  async updateTenantPolicy(
    @CurrentUser() currentUser: AuthUser,
    @Body() body: any,
    @Headers('x-tenant-id') tenantHeader?: string,
  ) {
    const tenantId = resolveTenantId(currentUser, tenantHeader);
    return this.authService.updateTenantAuthPolicy(tenantId, body);
  }

  // ─── PATCH /api/auth/users/:id/status ───────────────────────
  @Patch('users/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activate or deactivate a user account [ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'User status updated.' })
  @ApiResponse({ status: 403, description: 'ADMIN role required.' })
  async setUserStatus(
    @Param('id') userId: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.setUserActive(userId, body.isActive, currentUser.dbId);
  }

  // ─── PATCH /api/auth/users/:id ──────────────────────────────
  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user profile details, email typo, password, branch [ADMIN only]',
  })
  async updateUserDetails(
    @Param('id') userId: string,
    @Body() body: { fullName?: string; email?: string; password?: string; branchId?: string; businessUnitId?: string; roles?: string[] },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.updateUserDetails(userId, body, currentUser);
  }

  // ─── GET /api/auth/approvals/pending ────────────────────────
  @Get('approvals/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List users pending administrator approval [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Pending user list returned.' })
  async listPendingApprovals() {
    return this.authService.listPendingApprovals();
  }

  // ─── POST /api/auth/approvals/approve/:id ───────────────────
  @Post('approvals/approve/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve a user registration and configure market & limits [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'User approved and tenant configured successfully.' })
  async approveUser(
    @Param('id') userId: string,
    @Body() body: { market: string; subdomain?: string; userLimit?: number; maxBranches?: number },
  ) {
    return this.authService.approveUser(userId, body.market, body.subdomain, body.userLimit, body.maxBranches);
  }

  @Post('tenants/manual')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Manually create and activate a new company tenant [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 201, description: 'Company tenant and admin user created & activated.' })
  async createManualTenant(
    @Body() body: {
      companyName: string;
      subdomain: string;
      adminFullName: string;
      adminEmail: string;
      adminPassword?: string;
      userLimit?: number;
      maxBranches?: number;
      defaultMarket?: string;
    },
  ) {
    return this.authService.createManualTenant(body);
  }

  // ─── GET /api/auth/tenants ──────────────────────────────────
  @Get('tenants')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all tenants in the system [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant list returned.' })
  async listTenants() {
    return this.authService.listTenants();
  }

  @Get('tenants/:id/details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get full tenant details, user list, and usage stats [SUPER_ADMIN only]',
  })
  async getTenantDetails(@Param('id') tenantId: string) {
    return this.authService.getTenantDetails(tenantId);
  }

  // ─── PATCH /api/auth/tenants/:id/status ─────────────────────
  @Patch('tenants/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant status (ACTIVE/INACTIVE/PENDING) [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant status updated.' })
  async updateTenantStatus(
    @Param('id') tenantId: string,
    @Body() body: { status: string },
  ) {
    return this.authService.updateTenantStatus(tenantId, body.status);
  }

  // ─── PATCH /api/auth/tenants/:id/user-limit ─────────────────
  @Patch('tenants/:id/user-limit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant active user/seats limit [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant user limit updated.' })
  async updateTenantUserLimit(
    @Param('id') tenantId: string,
    @Body() body: { limit: number },
  ) {
    return this.authService.updateTenantUserLimit(tenantId, body.limit);
  }

  @Patch('tenants/:id/branch-limit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant max branches limit [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant max branches limit updated.' })
  async updateTenantBranchLimit(
    @Param('id') tenantId: string,
    @Body() body: { limit: number },
  ) {
    return this.authService.updateTenantBranchLimit(tenantId, body.limit);
  }

  // ─── PATCH /api/auth/tenants/:id/market ─────────────────────
  @Patch('tenants/:id/market')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant default staffing market [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant market updated.' })
  async updateTenantMarket(
    @Param('id') tenantId: string,
    @Body() body: { market: string },
  ) {
    return this.authService.updateTenantMarket(tenantId, body.market);
  }

  // ─── PATCH /api/auth/tenants/my-subdomain ───────────────────
  @Patch('tenants/my-subdomain')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant subdomain identifier [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Subdomain updated successfully.' })
  async updateMySubdomain(
    @CurrentUser() user: AuthUser,
    @Body() body: { subdomain: string },
  ) {
    return this.authService.updateTenantSubdomain(user.tenantId, body.subdomain);
  }

  // ─── PATCH /api/auth/tenants/my-settings ────────────────────
  @Patch('tenants/my-settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant general settings [ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant settings updated.' })
  async updateMySettings(
    @CurrentUser() user: AuthUser,
    @Body() body: {
      podSystemEnabled?: boolean;
      candidatePoolMode?: string;
      jobAssignmentMode?: string;
      jobAssignmentOptions?: any;
    },
  ) {
    return this.authService.updateTenantSettings(user.tenantId, body);
  }

  // ─── GET /api/auth/rbac/permissions ──────────────────────────
  @Get('rbac/permissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all system permissions',
  })
  async listAllPermissions() {
    return this.authService.listAllPermissions();
  }

  // ─── GET /api/auth/rbac/roles ────────────────────────────────
  @Get('rbac/roles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all company roles and permissions',
  })
  async listRoles(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('includeSystem') includeSystem?: string,
    @Headers('x-branch-id') headerBranchId?: string,
  ) {
    const bid = branchId || headerBranchId;
    return this.authService.listRoles(user.tenantId, bid, includeSystem === 'true');
  }

  @Get('rbac/assignable-roles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List active role pool available for user assignment (with system role substitutions applied)',
  })
  async getAssignableRolePool(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Headers('x-branch-id') headerBranchId?: string,
  ) {
    const bid = branchId || headerBranchId;
    return this.authService.getAssignableRolePool(user.tenantId, bid);
  }

  // ─── POST /api/auth/rbac/roles ───────────────────────────────
  @Post('rbac/roles')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new custom company role [ADMIN only]',
  })
  async createCustomRole(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; description: string; permissions: string[]; systemRole?: string; branchId?: string },
    @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    const bid = body.branchId || queryBranchId || headerBranchId;
    return this.authService.createCustomRole(user.tenantId, body.name, body.description, body.permissions, body.systemRole, bid, user.dbId);
  }

  // ─── PUT /api/auth/rbac/roles/:id ───────────────────────────
  @Put('rbac/roles/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update custom role details and permissions [ADMIN only]',
  })
  async updateCustomRole(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Body() body: { name?: string; description?: string; systemRole?: string; branchId?: string; permissions?: string[] },
  ) {
    return this.authService.updateCustomRole(user.tenantId, roleId, body, user.dbId);
  }

  // ─── PATCH /api/auth/rbac/roles/:id ─────────────────────────
  @Patch('rbac/roles/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update custom role details and permissions [ADMIN only]',
  })
  async patchCustomRole(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Body() body: { name?: string; description?: string; systemRole?: string; branchId?: string; permissions?: string[] },
  ) {
    return this.authService.updateCustomRole(user.tenantId, roleId, body, user.dbId);
  }

  // ─── PATCH /api/auth/rbac/roles/:id/permissions ──────────────
  @Patch('rbac/roles/:id/permissions')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update dynamic permissions for a custom role [ADMIN only]',
  })
  async updateRolePermissions(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Body() body: { permissions: string[] },
  ) {
    return this.authService.updateRolePermissions(user.tenantId, roleId, body.permissions);
  }

  // ─── DELETE /api/auth/rbac/roles/:id ──────────────────────────
  @Delete('rbac/roles/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a custom company role [ADMIN only]',
  })
  async deleteCustomRole(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Query('targetRoleId') targetRoleId?: string,
    @Body('targetRoleId') targetRoleIdBody?: string,
  ) {
    const finalTargetRoleId = targetRoleId || targetRoleIdBody;
    return this.authService.deleteCustomRole(user.tenantId, roleId, finalTargetRoleId);
  }


  // ─── POST /api/auth/rbac/users/:id/roles ─────────────────────
  @Post('rbac/users/:id/roles')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Assign custom roles to a user [ADMIN only]',
  })
  async assignUserRoles(
    @CurrentUser() user: AuthUser,
    @Param('id') targetUserId: string,
    @Body() body: { roleIds: string[] },
  ) {
    return this.authService.assignUserRoles(user.tenantId, targetUserId, body.roleIds, user.roles);
  }

  // ─── GET /api/auth/check-ssl-domain ─────────────────────────
  @Get('check-ssl-domain')
  @ApiOperation({ summary: 'Caddy On-Demand TLS domain validation' })
  async checkSslDomain(@Query('domain') domain?: string): Promise<string> {
    if (!domain) {
      return 'OK';
    }
    const cleanDomain = domain.toLowerCase().trim();
    // Allow root domain and any *.enfyjobs.com
    if (cleanDomain === 'enfyjobs.com' || cleanDomain.endsWith('.enfyjobs.com')) {
      return 'OK';
    }
    // Check if domain is registered in DB for custom client domains
    const isRegistered = await this.authService.isDomainRegistered(cleanDomain);
    if (isRegistered) {
      return 'OK';
    }
    throw new BadRequestException('Unauthorized Domain');
  }

  // ─── GET /api/auth/tenants/my-domains ───────────────────────
  @Get('tenants/my-domains')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List custom domains for active tenant [Tenant Admin/User]' })
  async getMyDomains(@CurrentUser() user: AuthUser) {
    return this.authService.getTenantDomains(user.tenantId);
  }

  // ─── POST /api/auth/tenants/my-domains ──────────────────────
  @Post('tenants/my-domains')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add custom domain for active tenant [ADMIN only]' })
  async addMyDomain(
    @CurrentUser() user: AuthUser,
    @Body() body: { domainName: string },
  ) {
    return this.authService.addTenantDomain(user.tenantId, body.domainName);
  }

  // ─── DELETE /api/auth/tenants/my-domains/:id ─────────────────
  @Delete('tenants/my-domains/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete custom domain for active tenant [ADMIN only]' })
  async deleteMyDomain(
    @CurrentUser() user: AuthUser,
    @Param('id') domainId: string,
  ) {
    return this.authService.deleteTenantDomain(user.tenantId, domainId);
  }

  // ─── POST /api/auth/tenants/my-domains/verify ───────────────
  @Post('tenants/my-domains/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify custom domain DNS records & provision SSL [ADMIN only]' })
  async verifyMyDomain(
    @CurrentUser() user: AuthUser,
    @Body() body: VerifyCustomDomainDto,
  ) {
    return this.authService.verifyCustomDomain(user.tenantId, body.domainName);
  }

  // ─── POST /api/auth/sso-login ───────────────────────────────
  @Post('sso-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Single Sign-On (Google & Microsoft) — Zero-Trust Invite-Only Gate',
    description: 'Validates verified OAuth email identity against tenant user invitation list and issues signed ATS JWT.',
  })
  @ApiResponse({ status: 200, description: 'SSO Login successful — returns ATS JWT access token.' })
  @ApiResponse({ status: 401, description: 'Access denied: user is not invited or account is deactivated.' })
  async ssoLogin(@Body() dto: SsoLoginDto) {
    return this.authService.ssoLogin(dto);
  }

  // ─── POST /api/auth/invite ──────────────────────────────────
  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'BRANCH_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Invite new team member to workspace [ADMIN / BRANCH_ADMIN only]',
    description: 'Creates pre-provisioned user record, generates 24-hr setup token, and dispatches branded welcome email from no-reply@tenant.enfycon.com.',
  })
  @ApiResponse({ status: 201, description: 'User invited and activation email dispatched.' })
  @ApiResponse({ status: 409, description: 'User already exists in this workspace.' })
  async inviteUser(
    @Body() dto: InviteUserDto,
    @Headers('authorization') authHeader?: string,
  ) {
    return this.authService.inviteUser(dto, authHeader);
  }

  // ─── GET /api/auth/invitation/:token ────────────────────────
  @Get('invitation/:token')
  @ApiOperation({
    summary: 'Get invitation metadata for password setup screen [Public]',
    description: 'Returns tenant name, subdomain, invited email, and expiration status.',
  })
  @ApiResponse({ status: 200, description: 'Invitation details retrieved.' })
  @ApiResponse({ status: 404, description: 'Invalid invitation token.' })
  async getInvitationDetails(@Param('token') token: string) {
    return this.authService.getInvitationDetails(token);
  }

  // ─── POST /api/auth/accept-invite ───────────────────────────
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept invitation & set user password [Public]',
    description: 'Consumes invitation token, sets user password hash, and marks account active.',
  })
  @ApiResponse({ status: 200, description: 'Password set successfully.' })
  @ApiResponse({ status: 400, description: 'Token expired or invalid.' })
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  // ─── GET /api/auth/tenant-auth-policy ───────────────────────
  @Get('tenant-auth-policy')
  @ApiOperation({
    summary: 'Get tenant SSO & authentication policy [Public / Tenant User]',
  })
  async getTenantAuthPolicy(
    @Query('subdomain') subdomain?: string,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const context = headerTenantId || subdomain || 'default';
    return this.authService.getTenantAuthPolicy(context);
  }

  // ─── PATCH /api/auth/tenant-auth-policy ──────────────────────
  @Patch('tenant-auth-policy')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update tenant SSO and authentication policy [ADMIN only]',
  })
  async updateTenantAuthPolicy(
    @CurrentUser() user: AuthUser,
    @Body() dto: any,
  ) {
    return this.authService.updateTenantAuthPolicy(user.tenantId, dto);
  }
}

