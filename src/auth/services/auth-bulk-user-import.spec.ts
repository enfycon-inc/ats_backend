import { ForbiddenException } from '@nestjs/common';
import { AuthInviteService } from './auth-invite.service';

describe('bulk user import validation', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const branchId = '22222222-2222-4222-8222-222222222222';
  const unitId = '33333333-3333-4333-8333-333333333333';
  const roleId = '44444444-4444-4444-8444-444444444444';
  const requester: any = {
    tenantId,
    branchId,
    businessUnitId: unitId,
    systemRole: 'UNIT_ADMIN',
    permissions: ['user:manage', 'unit_admin:manage'],
  };

  function service(existingEmails: string[] = []) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM branches')) return { rows: [{ id: branchId, name: 'Pune' }] };
      if (sql.includes('FROM business_units')) return { rows: [{ id: unitId, name: 'Technology Staffing', branch_id: branchId }] };
      if (sql.includes('FROM custom_roles')) return { rows: [{ id: roleId, name: 'Recruiter', branch_id: branchId, business_unit_id: unitId, system_key: 'RECRUITER' }] };
      if (sql.includes('FROM users WHERE LOWER(email)')) return { rows: existingEmails.map((email) => ({ email })) };
      return { rows: [] };
    });
    const instance = new AuthInviteService(
      { query } as any,
      {} as any,
      {} as any,
      { getTenantAuthPolicy: jest.fn().mockResolvedValue({ allowPersonalEmails: true, allowedEmailDomains: [] }) } as any,
      {} as any,
    );
    return { instance, query };
  }

  it('resolves valid assignments and normalizes an optional city', async () => {
    const { instance } = service();
    const [row] = await instance.validateBulkUsers([{
      fullName: 'Priya Sharma', email: ' PRIYA@example.com ', branch: ' pune ',
      unit: 'Technology Staffing', roles: 'Recruiter', city: 'Pune',
    }], requester);
    expect(row).toMatchObject({
      status: 'ready',
      normalized: { email: 'priya@example.com', branchId, businessUnitId: unitId, roleIds: [roleId], city: 'PUNE' },
    });
  });

  it('flags a typo with a suggestion without silently accepting it', async () => {
    const { instance } = service();
    const [row] = await instance.validateBulkUsers([{
      fullName: 'Priya Sharma', email: 'priya@example.com', branch: 'Pune',
      unit: 'Technology Staffng', roles: 'Recruiter',
    }], requester);
    expect(row.status).toBe('invalid');
    expect(row.suggestions.unit).toEqual(['Technology Staffing']);
  });

  it('rejects users without user management permission', async () => {
    const { instance } = service();
    await expect(instance.validateBulkUsers([], { ...requester, permissions: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
