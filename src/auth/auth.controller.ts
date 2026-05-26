import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
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
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './interfaces/auth-user.interface';


const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

@ApiTags('Auth & Identity')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
- This endpoint is NOT used. The frontend redirects to the Keycloak login page.
- The token is obtained directly from Keycloak.

**Default dev credentials:**
| Role             | Email                     | Password       |
|------------------|---------------------------|----------------|
| ADMIN            | admin@enfycon.com         | Admin@123      |
| RECRUITER        | recruiter@enfycon.com     | Recruiter@123  |
| ACCOUNT_MANAGER  | am@enfycon.com            | Manager@123    |
| DELIVERY_HEAD    | dh@enfycon.com            | Delivery@123   |
| TRACKER          | tracker@enfycon.com       | Tracker@123    |
    `.trim(),
  })
  @ApiResponse({ status: 200, description: 'Login successful — returns JWT access token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
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

  // ─── GET /api/auth/users ────────────────────────────────────
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'DELIVERY_HEAD')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all users in the tenant [ADMIN, DELIVERY_HEAD]',
    description: 'Returns all registered users scoped to the active tenant.',
  })
  @ApiResponse({ status: 200, description: 'User list returned.' })
  @ApiResponse({ status: 403, description: 'Insufficient role permissions.' })
  async listUsers(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantHeader?: string,
  ) {
    const tenantId = tenantHeader || user.tenantId || DEFAULT_TENANT_ID;
    return this.authService.listUsers(tenantId);
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

  // ─── PATCH /api/auth/users/:id/roles ────────────────────────
  @Patch('users/:id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user roles [ADMIN only]',
    description:
      'Assigns or replaces roles for a user. Valid roles: RECRUITER, ACCOUNT_MANAGER, DELIVERY_HEAD, ADMIN, TRACKER.',
  })
  @ApiResponse({ status: 200, description: 'Roles updated successfully.' })
  async updateRoles(
    @Param('id') userId: string,
    @Body() body: { roles: string[] },
  ) {
    return this.authService.updateUserRoles(userId, body.roles);
  }
}
