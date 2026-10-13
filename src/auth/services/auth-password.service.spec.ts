import { AuthPasswordService } from './auth-password.service';
import * as crypto from 'crypto';

describe('AuthPasswordService', () => {
  let service: AuthPasswordService;
  let authQuery: any;
  let keycloakService: any;
  let emailService: any;

  beforeEach(() => {
    authQuery = {
      query: jest.fn(),
    };
    keycloakService = {
      provisionUserInKeycloak: jest.fn().mockResolvedValue(true),
    };
    emailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue({ messageId: '123' }),
      sendPasswordChangedAlert: jest.fn().mockResolvedValue({ messageId: '456' }),
    };

    service = new AuthPasswordService(authQuery, keycloakService, emailService);
  });

  describe('forgotPassword', () => {
    it('returns generic success even if email is not found to prevent user enumeration', async () => {
      authQuery.query.mockResolvedValueOnce({ rows: [] });

      const res = await service.forgotPassword({ email: 'unknown@example.com' });
      expect(res.success).toBe(true);
      expect(res.message).toContain('If an account exists');
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('creates token, stores sha256 hash, and dispatches reset email when user exists', async () => {
      const user = {
        id: 'user-uuid-1',
        email: 'user@example.com',
        full_name: 'John Doe',
        is_active: true,
        is_approved: true,
        tenant_id: 'tenant-uuid-1',
        tenant_name: 'Acme Corp',
        tenant_domain: 'acme',
        tenant_status: 'ACTIVE',
      };
      authQuery.query
        .mockResolvedValueOnce({ rows: [user] }) // user lookup
        .mockResolvedValueOnce({ rows: [] }) // invalidate old tokens
        .mockResolvedValueOnce({ rows: [] }); // insert new token

      const res = await service.forgotPassword({ email: 'user@example.com' });
      expect(res.success).toBe(true);
      expect(authQuery.query).toHaveBeenCalledTimes(3);

      // Verify email dispatched
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-uuid-1',
          to: 'user@example.com',
          fullName: 'John Doe',
          tenantName: 'Acme Corp',
          subdomain: 'acme',
          resetToken: expect.any(String),
        }),
      );
    });
  });

  describe('verifyResetToken', () => {
    it('throws BadRequestException if token is missing', async () => {
      await expect(service.verifyResetToken('')).rejects.toThrow('Reset token is required.');
    });

    it('throws BadRequestException if token does not exist', async () => {
      authQuery.query.mockResolvedValueOnce({ rows: [] });
      await expect(service.verifyResetToken('invalid-token')).rejects.toThrow('Password reset link is invalid.');
    });

    it('throws BadRequestException if token is already used', async () => {
      authQuery.query.mockResolvedValueOnce({
        rows: [{ id: 't1', is_used: true, expires_at: new Date(Date.now() + 60000) }],
      });
      await expect(service.verifyResetToken('used-token')).rejects.toThrow('already been used');
    });

    it('throws BadRequestException if token is expired', async () => {
      authQuery.query.mockResolvedValueOnce({
        rows: [{ id: 't1', is_used: false, expires_at: new Date(Date.now() - 60000) }],
      });
      await expect(service.verifyResetToken('expired-token')).rejects.toThrow('expired');
    });

    it('returns valid true and email for valid active token', async () => {
      authQuery.query.mockResolvedValueOnce({
        rows: [
          {
            id: 't1',
            is_used: false,
            expires_at: new Date(Date.now() + 60000),
            email: 'user@example.com',
            full_name: 'John Doe',
            tenant_name: 'Acme Corp',
          },
        ],
      });

      const res = await service.verifyResetToken('valid-raw-token');
      expect(res.valid).toBe(true);
      expect(res.email).toBe('user@example.com');
      expect(res.tenantName).toBe('Acme Corp');
    });
  });

  describe('resetPassword', () => {
    it('consumes token and provisions new password in Keycloak', async () => {
      const rawToken = 'abc123token';
      authQuery.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'token-uuid',
              is_used: false,
              expires_at: new Date(Date.now() + 60000),
              user_id: 'user-uuid',
              email: 'user@example.com',
              full_name: 'John Doe',
              tenant_id: 'tenant-uuid',
              tenant_name: 'Acme Corp',
              tenant_domain: 'acme',
            },
          ],
        }) // query token
        .mockResolvedValueOnce({ rows: [] }); // update token is_used

      const res = await service.resetPassword({ token: rawToken, password: 'NewSecurePassword123!' });
      expect(res.success).toBe(true);

      // Verify token marked used
      expect(authQuery.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ats.password_reset_tokens'),
        ['token-uuid'],
      );

      // Verify Keycloak updated
      expect(keycloakService.provisionUserInKeycloak).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'NewSecurePassword123!',
        fullName: 'John Doe',
        tenantId: 'tenant-uuid',
      });

      // Verify security alert email sent
      expect(emailService.sendPasswordChangedAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          tenantName: 'Acme Corp',
        }),
      );
    });
  });

  describe('adminSendResetLink', () => {
    it('generates token and sends reset link for tenant user', async () => {
      const user = {
        id: 'target-user-id',
        email: 'recruiter@example.com',
        full_name: 'Jane Recruiter',
        is_active: true,
        tenant_id: 'tenant-uuid',
        tenant_name: 'Acme Corp',
        tenant_domain: 'acme',
      };

      authQuery.query
        .mockResolvedValueOnce({ rows: [user] }) // user check
        .mockResolvedValueOnce({ rows: [] }) // invalidate old
        .mockResolvedValueOnce({ rows: [] }); // insert token

      const requester: any = {
        email: 'admin@example.com',
        tenantId: 'tenant-uuid',
        permissions: ['user:manage'],
      };

      const res = await service.adminSendResetLink('target-user-id', requester);
      expect(res.success).toBe(true);
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'recruiter@example.com',
          tenantId: 'tenant-uuid',
        }),
      );
    });
  });
});
