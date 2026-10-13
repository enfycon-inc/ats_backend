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
import type { AuthUser } from '../interfaces/auth-user.interface';

@Injectable()
export class AuthPasswordService {
  private readonly logger = new Logger(AuthPasswordService.name);

  constructor(
    private readonly authQuery: AuthQueryService,
    private readonly keycloakService: AuthKeycloakService,
    private readonly emailService: AuthEmailService,
  ) {}

  /**
   * Public endpoint logic: Request a password reset email.
   * Generates a single-use cryptographically secure token, hashes it with SHA-256,
   * stores the hash with a 30-minute expiry, and dispatches the reset email via Brevo.
   * Always returns a generic success response to prevent email enumeration.
   */
  async forgotPassword(dto: { email: string }): Promise<{ success: boolean; message: string }> {
    const rawEmail = (dto?.email || '').trim().toLowerCase();
    if (!rawEmail || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(rawEmail)) {
      throw new BadRequestException('A valid email address is required.');
    }

    const genericSuccess = {
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
    };

    try {
      const userRes = await this.authQuery.query(
        `SELECT u.id, u.email, u.full_name, u.is_active, u.is_approved, u.tenant_id,
                t.name as tenant_name, t.domain as tenant_domain, t.status as tenant_status
         FROM users u
         JOIN tenants t ON u.tenant_id = t.id
         WHERE LOWER(TRIM(u.email)) = $1
         LIMIT 1`,
        [rawEmail],
      );

      if (userRes.rows.length === 0) {
        this.logger.warn(`Password reset requested for unknown email: ${rawEmail}`);
        return genericSuccess;
      }

      const user = userRes.rows[0];
      if (!user.is_active || !user.is_approved || (user.tenant_status && user.tenant_status !== 'ACTIVE')) {
        this.logger.warn(`Password reset requested for inactive user or tenant: ${rawEmail}`);
        return genericSuccess;
      }

      // Generate a 32-byte secure random token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Invalidate previous pending tokens for this user
      await this.authQuery.query(
        `UPDATE ats.password_reset_tokens 
         SET is_used = true, used_at = NOW() 
         WHERE user_id = $1::uuid AND is_used = false`,
        [user.id],
      );

      // Persist the new token hash
      await this.authQuery.query(
        `INSERT INTO ats.password_reset_tokens (tenant_id, user_id, token_hash, expires_at, is_used, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, false, NOW())`,
        [user.tenant_id, user.id, tokenHash, expiresAt],
      );

      // Dispatch reset email
      await this.emailService.sendPasswordResetEmail({
        tenantId: user.tenant_id,
        to: user.email,
        fullName: user.full_name || 'Team Member',
        tenantName: user.tenant_name || 'EnfySync Workspace',
        subdomain: user.tenant_domain || '',
        resetToken: rawToken,
      });

      this.logger.log(`Password reset link dispatched to ${user.email} (Tenant: ${user.tenant_name})`);
    } catch (err: any) {
      this.logger.error(`Error processing forgot password request: ${err.message}`, err.stack);
      // Still return generic success to avoid leaking internal errors or user state
    }

    return genericSuccess;
  }

  /**
   * Public endpoint logic: Verify if a reset token is valid and unexpired before rendering the form.
   */
  async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string; fullName?: string; tenantName?: string }> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new BadRequestException('Reset token is required.');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const res = await this.authQuery.query(
      `SELECT prt.id, prt.expires_at, prt.is_used, u.email, u.full_name, t.name as tenant_name
       FROM ats.password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       JOIN tenants t ON prt.tenant_id = t.id
       WHERE prt.token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    if (res.rows.length === 0) {
      throw new BadRequestException('Password reset link is invalid.');
    }

    const row = res.rows[0];
    if (row.is_used) {
      throw new BadRequestException('This password reset link has already been used.');
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('This password reset link has expired. Please request a new one.');
    }

    return {
      valid: true,
      email: row.email,
      fullName: row.full_name,
      tenantName: row.tenant_name,
    };
  }

  /**
   * Public endpoint logic: Consume the reset token and update the user's password in Keycloak.
   */
  async resetPassword(dto: { token: string; password: string }): Promise<{ success: boolean; message: string }> {
    if (!dto?.token || !dto?.password) {
      throw new BadRequestException('Token and password are required.');
    }

    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    const tokenHash = crypto.createHash('sha256').update(dto.token.trim()).digest('hex');

    const res = await this.authQuery.query(
      `SELECT prt.id, prt.expires_at, prt.is_used, u.id as user_id, u.email, u.full_name, u.tenant_id,
              t.name as tenant_name, t.domain as tenant_domain
       FROM ats.password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       JOIN tenants t ON prt.tenant_id = t.id
       WHERE prt.token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    if (res.rows.length === 0) {
      throw new BadRequestException('Password reset link is invalid.');
    }

    const row = res.rows[0];
    if (row.is_used) {
      throw new BadRequestException('This password reset link has already been used.');
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('This password reset link has expired. Please request a new one.');
    }

    // Mark token as consumed atomically
    await this.authQuery.query(
      `UPDATE ats.password_reset_tokens 
       SET is_used = true, used_at = NOW() 
       WHERE id = $1::uuid`,
      [row.id],
    );

    // Sync new password to Keycloak
    await this.keycloakService.provisionUserInKeycloak({
      email: row.email,
      password: dto.password,
      fullName: row.full_name,
      tenantId: row.tenant_id,
    });

    // Send security alert email to the user
    this.emailService.sendPasswordChangedAlert({
      tenantId: row.tenant_id,
      to: row.email,
      fullName: row.full_name || 'Team Member',
      tenantName: row.tenant_name || 'EnfySync Workspace',
      subdomain: row.tenant_domain || '',
    }).catch((mailErr: any) => {
      this.logger.warn(`Failed to dispatch password changed security alert: ${mailErr.message}`);
    });

    this.logger.log(`Password reset successfully completed for ${row.email}`);

    return {
      success: true,
      message: 'Your password has been reset successfully. You can now log in with your new password.',
    };
  }

  /**
   * Authenticated Admin Action: Send a secure password reset link to an existing user's email.
   */
  async adminSendResetLink(userId: string, requester: AuthUser): Promise<{ success: boolean; message: string }> {
    const userRes = await this.authQuery.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.tenant_id,
              t.name as tenant_name, t.domain as tenant_domain
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1::uuid AND u.tenant_id = $2::uuid
       LIMIT 1`,
      [userId, requester.tenantId],
    );

    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found in this workspace.');
    }

    const targetUser = userRes.rows[0];

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for admin-initiated links

    // Invalidate previous pending tokens
    await this.authQuery.query(
      `UPDATE ats.password_reset_tokens 
       SET is_used = true, used_at = NOW() 
       WHERE user_id = $1::uuid AND is_used = false`,
      [targetUser.id],
    );

    // Insert new token
    await this.authQuery.query(
      `INSERT INTO ats.password_reset_tokens (tenant_id, user_id, token_hash, expires_at, is_used, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, false, NOW())`,
      [targetUser.tenant_id, targetUser.id, tokenHash, expiresAt],
    );

    // Dispatch email
    await this.emailService.sendPasswordResetEmail({
      tenantId: targetUser.tenant_id,
      to: targetUser.email,
      fullName: targetUser.full_name || 'Team Member',
      tenantName: targetUser.tenant_name || 'EnfySync Workspace',
      subdomain: targetUser.tenant_domain || '',
      resetToken: rawToken,
    });

    this.logger.log(`Admin ${requester.email} sent password reset link to ${targetUser.email}`);

    return {
      success: true,
      message: `Password reset link sent to ${targetUser.email}.`,
    };
  }
}
