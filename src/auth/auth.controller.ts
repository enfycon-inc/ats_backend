import {
  Controller,
  ParseUUIDPipe,
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
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
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

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body('refreshToken') refreshToken: string) {
    return this.authService.logoutKeycloakSession(refreshToken);
  }

  // ─── GET /api/auth/diagnostic ──────────────────────────────
  @Get('diagnostic')
  @UseGuards(JwtAuthGuard)
  async diagnostic() {
    return this.authService.diagnostic();
  }

  // ─── POST /api/auth/register ────────────────────────────────
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Register new user account',
    description: 'Creates a new user. Admins can create approved users.',
  })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  @ApiResponse({ status: 400, description: 'Invalid role or missing fields.' })
  async register(
    @Body() dto: RegisterDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.authService.register(dto, user);
  }

  // ─── POST /api/auth/register-tenant ─────────────────────────
  @Get('check-email')
  @ApiOperation({
    summary: 'Check if an email is already registered globally (Public)',
    description: 'Returns true if the email is available, false if already taken in any tenant.',
  })
  @ApiResponse({ status: 200, description: 'Availability status returned.' })
  async checkEmail(@Query('email') email: string) {
    return this.authService.checkEmailAvailability(email);
  }

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
    return this.authService.getProfile(user.dbId, user);
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
    return this.authService.getProfile(user.dbId, user);
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
    // Branch Admins / Unit Admins can only see their own branch/unit users
    const perms = Array.isArray((user as any).permissions) ? (user as any).permissions : [];
    const isTenantAdmin = perms.includes('tenant:settings');
    
    const isBranchAdmin = perms.includes('branch_admin:manage') && !isTenantAdmin;
    const isUnitAdmin = perms.includes('unit_admin:manage') && !isTenantAdmin;
    
    let scopedBranchId = null;
    let scopedBusinessUnitId = null;
    
    if (isBranchAdmin || isUnitAdmin) {
      scopedBranchId = (user as any).branchId || null;
    }
    if (isUnitAdmin) {
      scopedBusinessUnitId = (user as any).businessUnitId || null;
    }
    
    let users = await this.authService.listUsers(tenantId, scopedBranchId, scopedBusinessUnitId);
    
    if (isUnitAdmin || isBranchAdmin) {
      users = users.filter((u: any) => {
        const p = Array.isArray(u.permissions) ? u.permissions : [];
        if (isUnitAdmin && (p.includes('tenant:settings') || p.includes('branch_admin:manage'))) {
          return false; // Unit admin cannot see tenant admins or branch admins
        }
        if (isBranchAdmin && p.includes('tenant:settings')) {
          return false; // Branch admin cannot see tenant admins
        }
        return true;
      });
    }
    
    return users;
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
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
    return this.authService.setUserActive(userId, body.isActive, currentUser.dbId, currentUser);
  }

  // ─── DELETE /api/auth/users/:id ─────────────────────────────
  @Delete('users/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Permanently delete a user account and revoke Keycloak access [ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'User deleted successfully.' })
  @ApiResponse({ status: 403, description: 'ADMIN role required.' })
  async deleteUser(
    @Param('id') userId: string,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.deleteUser(userId, currentUser);
  }

  // ─── PATCH /api/auth/users/:id ──────────────────────────────
  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user profile details, email typo, password, branch, reviewer [ADMIN only]',
  })
  async updateUserDetails(
    @Param('id') userId: string,
    @Body() body: { fullName?: string; email?: string; password?: string; branchId?: string; businessUnitId?: string; roleId?: string; assignedRoleIds?: string[]; roles?: string[]; jobReviewerId?: string | null },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.updateUserDetails(userId, body, currentUser);
  }

  // ─── POST /api/auth/users/bulk-reviewer ─────────────────────
  @Post('users/bulk-reviewer')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bulk update designated job reviewer for selected users',
  })
  async bulkSetJobReviewer(
    @Body() body: { userIds: string[]; reviewerId?: string | null },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.bulkSetJobReviewer(currentUser.tenantId, body.userIds, body.reviewerId || null);
  }


  // ─── POST /api/auth/request-role ────────────────────────────
  @Post('request-role')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request a role for newly joined user',
    description: 'Submits a role request to workspace administrators for review and approval.',
  })
  async requestRole(
    @CurrentUser() currentUser: AuthUser,
    @Body() body: { role: string; branchId?: string; businessUnitId?: string },
  ) {
    if (!body?.role) throw new BadRequestException('Role is required');
    return this.authService.requestRole(currentUser.dbId, body.role, body.branchId, body.businessUnitId);
  }

  // ─── PATCH /api/auth/users/:id/approve ──────────────────────
  @Patch('users/:id/approve')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve a pending user registration and assign role/branch [ADMIN / BRANCH_ADMIN]',
  })
  async approveTenantUser(
    @Param('id') userId: string,
    @Body() body: { roleId?: string; roleIds?: string[]; branchId?: string; businessUnitId?: string; roles?: string[] },
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.approveTenantUser(userId, body, currentUser);
  }


  // ─── PATCH /api/auth/users/:id/reject ───────────────────────
  @Patch('users/:id/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reject a pending user registration request [ADMIN / BRANCH_ADMIN]',
  })
  async rejectTenantUser(
    @Param('id') userId: string,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.authService.rejectTenantUser(userId, currentUser);
  }

  // ─── GET /api/auth/approvals/pending ────────────────────────
  @Get('approvals/pending')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Manually create and activate a new company tenant [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 201, description: 'Company tenant and admin user created & activated.' })
  async createManualTenant(
    @Body() body: {
      companyName: string;
      subdomain: string;
      adminFirstName: string;
        adminLastName: string;
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all tenants in the system [SUPER_ADMIN only]',
  })
  @ApiResponse({ status: 200, description: 'Tenant list returned.' })
  async listTenants() {
    return this.authService.listTenants();
  }

  @Patch('tenants/:id/management')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
  @ApiBearerAuth()
  async updateTenant(
    @Param('id', new ParseUUIDPipe()) tenantId: string,
    @Body() body: { name?: string; subdomain?: string; userLimit?: number; maxBranches?: number },
  ) {
    return this.authService.updateTenant(tenantId, body);
  }

  @Get('tenants/:id/details')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get full tenant details, user list, and usage stats [SUPER_ADMIN only]',
  })
  async getTenantDetails(@Param('id') tenantId: string) {
    return this.authService.getTenantDetails(tenantId);
  }

  // ─── PATCH /api/auth/tenants/:id/status ─────────────────────
  @Patch('tenants/:id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('platform:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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
      jobCodePattern?: string;
      enforceJobCodePattern?: boolean;
      siteTitle?: string;
      logoUrl?: string;
      name?: string;
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
    const isBranchAdmin =
      Array.isArray((user as any).permissions) &&
      (user as any).permissions.includes('branch_admin:manage') &&
      !(user as any).permissions.includes('tenant:settings');

    let bid: string | string[] | undefined;
    if (isBranchAdmin) {
      bid = (user as any).branchId || undefined;
    } else {
      bid = branchId && branchId !== 'ALL'
        ? branchId
        : headerBranchId && headerBranchId !== 'ALL'
        ? headerBranchId
        : undefined;
    }
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
    @Body() body: { name: string; description: string; permissions: string[]; systemRole?: string; baseRoleId?: string; branchId?: string; businessUnitId?: string },
    @Headers('x-branch-id') headerBranchId?: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    const bid = body.branchId || queryBranchId || headerBranchId;
    return this.authService.createCustomRole(user.tenantId, body.name, body.description, body.permissions, body.systemRole, bid, body.businessUnitId, user.dbId, body.baseRoleId, user);
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
    @Body() body: { name?: string; description?: string; systemRole?: string; baseRoleId?: string; branchId?: string; businessUnitId?: string; permissions?: string[] },
  ) {
    return this.authService.updateCustomRole(user.tenantId, roleId, body, user.dbId, user);
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
    return this.authService.updateCustomRole(user.tenantId, roleId, body, user.dbId, user);
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
    return this.authService.updateRolePermissions(user.tenantId, roleId, body.permissions, user);
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
    return this.authService.deleteCustomRole(user.tenantId, roleId, finalTargetRoleId, user);
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
    @Body() body: { roleIds: string[]; append?: boolean },
  ) {
    return this.authService.assignUserRoles(user.tenantId, targetUserId, body.roleIds, user.roles, body.append, user);
  }

  // ─── POST /api/auth/rbac/roles/:id/assign-users ───────────────
  @Post('rbac/roles/:id/assign-users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Batch assign multiple users to a custom role' })
  async batchAssignUsers(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Body() body: { userIds: string[] },
  ) {
    return this.authService.batchAssignUsersToRole(user.tenantId, roleId, body.userIds, user.roles, user);
  }

  // ─── POST /api/auth/rbac/roles/:id/unassign-user ─────────────
  @Post('rbac/roles/:id/unassign-user')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unassign a user from a specific custom role' })
  async unassignUser(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Body() body: { userId: string },
  ) {
    return this.authService.unassignUserFromRole(user.tenantId, roleId, body.userId, user);
  }

  // ─── GET /api/auth/check-ssl-domain ─────────────────
  // Called by Caddy on_demand TLS before issuing any SSL certificate.
  // SECURITY: Only issue certs for platform subdomains or DB-registered tenant workspaces.
  @Get('check-ssl-domain')
  @ApiOperation({ summary: 'Caddy On-Demand TLS domain validation' })
  async checkSslDomain(@Query('domain') domain?: string): Promise<string> {
    if (!domain) return 'OK';

    const cleanDomain = domain.toLowerCase().trim();

    // 1. Always allow the root domain
    if (cleanDomain === 'enfyjobs.com' || cleanDomain === 'www.enfyjobs.com') {
      return 'OK';
    }

    // 2. For *.enfyjobs.com subdomains — enforce DB verification
    if (cleanDomain.endsWith('.enfyjobs.com')) {
      const subdomain = cleanDomain.slice(0, cleanDomain.length - '.enfyjobs.com'.length);

      // 2a. Hardcoded platform subdomains always get a cert — no DB lookup needed
      const PLATFORM_SUBDOMAINS = new Set(['api', 'auth', 'db', 'www', 'admin', 'mail', 'status', 'app']);
      if (PLATFORM_SUBDOMAINS.has(subdomain)) return 'OK';

      // 2b. All other subdomains MUST be a registered tenant in the DB
      const isRegistered = await this.authService.isDomainRegistered(cleanDomain);
      if (isRegistered) return 'OK';

      // Deny — prevents cert exhaustion attacks against Let's Encrypt quota
      throw new BadRequestException(`Subdomain "${subdomain}" is not a registered workspace.`);
    }

    // 3. Custom domains (e.g. recruitmentsolutions.io) — check tenant_domains table
    const isRegistered = await this.authService.isDomainRegistered(cleanDomain);
    if (isRegistered) return 'OK';

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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('user:manage')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:settings')
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


