import { PodsService } from './pods.service';
import { PodsController } from './pods.controller';
import { ForbiddenException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

describe('PodsService & PodsController - Unit Scoping & Recruiter Eligibility', () => {
  let prismaMock: any;
  let podsService: PodsService;
  let podsController: PodsController;

  const tenantId = 'tenant-123';
  const unitId = 'unit-123';
  const foreignUnitId = 'unit-456';
  const branchId = 'branch-123';

  const deliveryHeadUser: AuthUser = {
    dbId: 'dh-1',
    keycloakId: 'kc-dh',
    email: 'dh@enfycon.com',
    fullName: 'Delivery Head User',
    roles: ['DELIVERY_HEAD'],
    systemRole: 'DELIVERY_HEAD',
    tenantId,
    isActive: true,
    branchId,
    businessUnitId: unitId,
    permissions: ['pod:view', 'pod:create', 'pod:edit', 'pod:delete', 'pod:reset_cycle', 'job:view_all_branches'],
  };

  const unitAdminUser: AuthUser = {
    dbId: 'ua-1',
    keycloakId: 'kc-ua',
    email: 'ua@enfycon.com',
    fullName: 'Unit Admin User',
    roles: ['UNIT_ADMIN'],
    systemRole: 'UNIT_ADMIN',
    tenantId,
    isActive: true,
    branchId,
    businessUnitId: unitId,
    permissions: ['pod:view', 'pod:create', 'pod:edit', 'pod:delete', 'pod:reset_cycle', 'unit_admin:manage'],
  };

  const tenantAdminUser: AuthUser = {
    dbId: 'ta-1',
    keycloakId: 'kc-ta',
    email: 'admin@enfycon.com',
    fullName: 'Tenant Admin',
    roles: ['TENANT_ADMIN'],
    systemRole: 'TENANT_ADMIN',
    tenantId,
    isActive: true,
    permissions: ['tenant:manage', 'pod:view', 'pod:create', 'pod:edit', 'pod:delete', 'pod:reset_cycle'],
  };

  beforeEach(() => {
    prismaMock = {
      businessUnit: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.id === unitId) return { id: unitId, branchId };
          if (where.id === foreignUnitId) return { id: foreignUnitId, branchId: 'other-branch' };
          return null;
        }),
        findUnique: jest.fn(async ({ where }) => {
          if (where.id === '703e5263-a50d-4484-8ad5-d382625b8b87') {
            return { id: '703e5263-a50d-4484-8ad5-d382625b8b87', branchId: 'bhubneswar' };
          }
          return null;
        }),
      },
      pod: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        delete: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customRole: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prismaMock)),
    };

    podsService = new PodsService(prismaMock);
    podsController = new PodsController(podsService);
  });

  describe('Scope Resolution (Unit Scoping)', () => {
    it('restricts Delivery Head strictly to their assigned unit and ignores branch headers', async () => {
      const scope = await podsService.resolveScope(tenantId, deliveryHeadUser, undefined, 'some-other-branch');
      expect(scope.businessUnitId).toBe(unitId);
      expect(scope.branchId).toBe(branchId);
    });

    it('restricts Unit Admin strictly to their assigned unit', async () => {
      const scope = await podsService.resolveScope(tenantId, unitAdminUser);
      expect(scope.businessUnitId).toBe(unitId);
      expect(scope.branchId).toBe(branchId);
    });

    it('denies Delivery Head or Unit Admin if they attempt to query a foreign unit', async () => {
      await expect(
        podsService.resolveScope(tenantId, deliveryHeadUser, foreignUnitId)
      ).rejects.toThrow(ForbiddenException);

      await expect(
        podsService.resolveScope(tenantId, unitAdminUser, foreignUnitId)
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies Delivery Head without assigned unit', async () => {
      const dhNoUnit: AuthUser = { ...deliveryHeadUser, businessUnitId: undefined };
      await expect(
        podsService.resolveScope(tenantId, dhNoUnit)
      ).rejects.toThrow(ForbiddenException);
    });

    it('requires unit for Tenant Admin when requireUnit is true', async () => {
      await expect(
        podsService.resolveScope(tenantId, tenantAdminUser, undefined, undefined, true)
      ).rejects.toThrow(BadRequestException);

      const scope = await podsService.resolveScope(tenantId, tenantAdminUser, unitId, undefined, true);
      expect(scope.businessUnitId).toBe(unitId);
      expect(scope.branchId).toBe(branchId);
    });
  });

  describe('Pod Access Assertion', () => {
    const podInUnit = {
      id: 'pod-1',
      name: 'Alpha Pod',
      businessUnitId: unitId,
      branchId,
      podHeadId: 'lead-1',
      members: [{ id: 'rec-1', fullName: 'Recruiter 1', email: 'r1@test.com', systemRole: 'RECRUITER' }],
    };

    const podInForeignUnit = {
      id: 'pod-foreign',
      name: 'Beta Pod',
      businessUnitId: foreignUnitId,
      branchId: 'other-branch',
      podHeadId: 'lead-2',
      members: [],
    };

    it('allows Delivery Head to access pods in their unit', async () => {
      await expect(podsService.assertPodAccess(tenantId, deliveryHeadUser, podInUnit)).resolves.not.toThrow();
    });

    it('denies Delivery Head access to pods outside their unit', async () => {
      await expect(
        podsService.assertPodAccess(tenantId, deliveryHeadUser, podInForeignUnit)
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Tenant Admin to access pods across any unit', async () => {
      await expect(podsService.assertPodAccess(tenantId, tenantAdminUser, podInForeignUnit)).resolves.not.toThrow();
    });
  });

  describe('Recruiter Eligibility & Cross-Pod Assignment Validation', () => {
    it('rejects adding users who are already assigned to another pod', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: 'user-busy',
          fullName: 'Busy Recruiter',
          isActive: true,
          isApproved: true,
          businessUnitId: unitId,
          podId: 'other-pod-999',
          pod: { id: 'other-pod-999', name: 'Other Existing Pod' },
          customRole: {
            name: 'Recruiter',
            systemRole: { systemKey: 'RECRUITER' },
          },
        },
      ]);

      const dto = {
        name: 'New Pod',
        businessUnitId: unitId,
        recruiterIds: ['user-busy'],
      };

      await expect(podsService.create(dto, tenantId, branchId, unitId)).rejects.toThrow(ConflictException);
      await expect(podsService.create(dto, tenantId, branchId, unitId)).rejects.toThrow(
        /is already assigned to recruitment pod "Other Existing Pod"/
      );
    });

    it('rejects adding users who do not have a recruiter role', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: 'user-manager',
          fullName: 'Account Manager User',
          isActive: true,
          isApproved: true,
          businessUnitId: unitId,
          podId: null,
          customRole: {
            name: 'Account Manager',
            systemRole: { systemKey: 'ACCOUNT_MANAGER' },
          },
        },
      ]);

      const dto = {
        name: 'New Pod',
        businessUnitId: unitId,
        recruiterIds: ['user-manager'],
      };

      await expect(podsService.create(dto, tenantId, branchId, unitId)).rejects.toThrow(BadRequestException);
      await expect(podsService.create(dto, tenantId, branchId, unitId)).rejects.toThrow(
        /do not have an eligible recruiter role/
      );
    });

    it('rejects recruiters belonging to a different operating unit', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: 'foreign-recruiter',
          fullName: 'Foreign Recruiter',
          isActive: true,
          isApproved: true,
          businessUnitId: foreignUnitId,
          podId: null,
          customRole: {
            name: 'Recruiter',
            systemRole: { systemKey: 'RECRUITER' },
          },
        },
      ]);

      const dto = {
        name: 'New Pod',
        businessUnitId: unitId,
        recruiterIds: ['foreign-recruiter'],
      };

      await expect(podsService.create(dto, tenantId, branchId, unitId)).rejects.toThrow(ConflictException);
      await expect(podsService.create(dto, tenantId, branchId, unitId)).rejects.toThrow(
        /belongs to a different operating unit/
      );
    });

    it('returns only unassigned recruiters with recruiter roles in getAvailableRecruiters', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: 'free-rec-1',
          fullName: 'Alice Recruiter',
          email: 'alice@test.com',
          businessUnitId: unitId,
          branchId,
          customRole: { name: 'Recruiter', systemRole: { systemKey: 'RECRUITER' } },
        },
        {
          id: 'staff-admin',
          fullName: 'Bob Admin',
          email: 'bob@test.com',
          businessUnitId: unitId,
          branchId,
          customRole: { name: 'Delivery Head', systemRole: { systemKey: 'DELIVERY_HEAD' } },
        },
      ]);

      const available = await podsService.getAvailableRecruiters(tenantId, branchId, unitId);
      expect(available.length).toBe(1);
      expect(available[0].id).toBe('free-rec-1');
      expect(available[0].fullName).toBe('Alice Recruiter');
    });
  });

  describe('PodsController Unit Scope Enforcement', () => {
    it('scopes findAll to unit for Delivery Head', async () => {
      const findAllSpy = jest.spyOn(podsService, 'findAll').mockResolvedValue([]);
      await podsController.findAll(deliveryHeadUser, tenantId, undefined, 'branch-xyz', 'all');
      expect(findAllSpy).toHaveBeenCalledWith(tenantId, branchId, unitId);
    });

    it('scopes create to unit for Unit Admin', async () => {
      const createSpy = jest.spyOn(podsService, 'create').mockResolvedValue({
        id: 'new-pod',
        name: 'New Pod',
        branchId,
        branchName: 'Main Branch',
        businessUnitId: unitId,
        businessUnitName: 'Main Unit',
        podHeadId: null,
        podHeadName: null,
        description: null,
        isAvailableForAssignment: true,
        members: [],
        jobsCount: 0,
        createdAt: new Date().toISOString(),
      });

      await podsController.create({ name: 'New Pod' }, unitAdminUser, tenantId);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Pod', businessUnitId: unitId, branchId }),
        tenantId,
        branchId,
        unitId,
      );
    });
  });
});
