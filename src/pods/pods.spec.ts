import { PodsService } from './pods.service';
import { PodsController } from './pods.controller';
import { ForbiddenException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { Prisma } from '@prisma/client';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Reflector } from '@nestjs/core';

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
    permissions: ['pod:view', 'pod:create', 'pod:edit', 'pod:delete', 'pod:reset_cycle', 'job:view_all_branches', 'unit_admin:manage'],
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
      tenant: { findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: true }) },
      businessUnit: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.allowPods === true) return { id: unitId, branchId, allowPods: true };
          if (where.id === unitId) return { id: unitId, branchId, allowPods: true };
          if (where.id === foreignUnitId) return { id: foreignUnitId, branchId: 'other-branch', allowPods: true };
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
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callback) => callback(prismaMock)),
    };

    podsService = new PodsService(prismaMock);
    podsController = new PodsController(podsService);
  });

  describe('Assigned pod deletion protection', () => {
    it('rejects all linked jobs before changing the lead or members', async () => {
      prismaMock.pod.findFirst.mockResolvedValue({ id: 'pod', podHeadId: 'lead', _count: { jobPods: 1 } });
      const demote = jest.spyOn(podsService as any, 'demoteFromPodHead');
      await expect(podsService.remove('pod', tenantId)).rejects.toThrow(ConflictException);
      expect(prismaMock.pod.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pod', tenantId } }));
      expect(demote).not.toHaveBeenCalled();
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.pod.delete).not.toHaveBeenCalled();
    });

    it('allows an unassigned pod to be deleted', async () => {
      prismaMock.pod.findFirst.mockResolvedValue({ id: 'pod', podHeadId: null, _count: { jobPods: 0 } });
      await expect(podsService.remove('pod', tenantId)).resolves.toEqual({ message: 'Pod deleted successfully.' });
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith({ where: { podId: 'pod', tenantId }, data: { podId: null } });
      expect(prismaMock.pod.delete).toHaveBeenCalledWith({ where: { id: 'pod' } });
    });

    it('throws a conflict out of the transaction when a concurrent assignment blocks deletion', async () => {
      prismaMock.pod.findFirst.mockResolvedValue({ id: 'pod', podHeadId: null, _count: { jobPods: 0 } });
      prismaMock.pod.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: Prisma.prismaVersion.client }));
      await expect(podsService.remove('pod', tenantId)).rejects.toThrow('Reassign or remove all job assignments first.');
      // The transaction promise rejects, so Prisma rolls back every prior write.
      await expect(prismaMock.$transaction.mock.results[0].value).rejects.toThrow(ConflictException);
    });

    it('rejects a missing or foreign-tenant pod without writes', async () => {
      prismaMock.pod.findFirst.mockResolvedValue(null);
      await expect(podsService.remove('foreign-pod', tenantId)).rejects.toThrow(NotFoundException);
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.pod.delete).not.toHaveBeenCalled();
    });

    it('preserves unexpected errors rather than reporting an assignment conflict', async () => {
      prismaMock.pod.findFirst.mockResolvedValue({ id: 'pod', podHeadId: null, _count: { jobPods: 0 } });
      const error = new Error('Unexpected failure');
      prismaMock.pod.delete.mockRejectedValue(error);
      await expect(podsService.remove('pod', tenantId)).rejects.toBe(error);
    });

    it('requires pod:delete independently of edit or create permissions', () => {
      const guard = new PermissionsGuard(new Reflector());
      const context = (permissions: string[]) => ({
        getHandler: () => PodsController.prototype.remove,
        getClass: () => PodsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
      }) as any;
      expect(() => guard.canActivate(context(['pod:edit', 'pod:create']))).toThrow(ForbiddenException);
      expect(guard.canActivate(context(['pod:delete']))).toBe(true);
    });
  });

  describe('Scope Resolution (Unit Scoping)', () => {
    it('blocks pod endpoints when the tenant disables pods, even for administrators', async () => {
      prismaMock.tenant.findUnique.mockResolvedValue({ podSystemEnabled: false });
      await expect(podsController.findAll(tenantAdminUser)).rejects.toThrow('disabled');
      expect(prismaMock.pod.findMany).not.toHaveBeenCalled();
    });

    it('blocks pod endpoints when the current operating unit disables pods', async () => {
      prismaMock.businessUnit.findFirst.mockResolvedValue({ id: unitId, branchId, allowPods: false });
      await expect(podsController.findAll(unitAdminUser)).rejects.toThrow('disabled');
      expect(prismaMock.pod.findMany).not.toHaveBeenCalled();
    });

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
        unitAdminUser,
      );
    });
  });

  describe('Pod Lead Promotion & Demotion Role Synchronization', () => {
    const podLeadRoleId = 'role-pod-lead-uuid';
    const recruiterRoleId = 'role-recruiter-uuid';
    const formerLeadId = 'user-former-lead';
    const newLeadId = 'user-new-lead';
    const podId = 'pod-123';

    beforeEach(() => {
      prismaMock.customRole.findMany.mockImplementation(async ({ where }: any) => {
        if (where?.systemRole?.systemKey === 'POD_LEAD') {
          return [{ id: podLeadRoleId, name: 'Pod Lead', businessUnitId: unitId, systemRole: { systemKey: 'POD_LEAD' } }];
        }
        return [];
      });

      prismaMock.customRole.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.systemRole?.systemKey === 'POD_LEAD') {
          return { id: podLeadRoleId, name: 'Pod Lead' };
        }
        if (where?.systemRole?.systemKey === 'RECRUITER') {
          return { id: recruiterRoleId, name: 'Recruiter' };
        }
        return null;
      });
    });

    it('strips POD_LEAD role from assignedRoleIds and sets roleId to RECRUITER when demoting', async () => {
      prismaMock.pod.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === podId) {
          return {
            id: podId,
            name: 'POD(Backend)',
            podHeadId: formerLeadId,
            branchId,
            businessUnitId: unitId,
            description: null,
            users: [{ id: formerLeadId }],
          };
        }
        // otherPods check
        if (where?.podHeadId === formerLeadId) {
          return null; // leads no other pods
        }
        return null;
      });

      prismaMock.user.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === formerLeadId) {
          return {
            id: formerLeadId,
            roleId: podLeadRoleId,
            assignedRoleIds: [recruiterRoleId, podLeadRoleId],
            branchId,
          };
        }
        if (where?.id === newLeadId) {
          return {
            id: newLeadId,
            roleId: recruiterRoleId,
            assignedRoleIds: [recruiterRoleId],
            branchId,
          };
        }
        return null;
      });

      prismaMock.user.findMany.mockResolvedValue([
        {
          id: newLeadId,
          fullName: 'New Lead',
          isActive: true,
          isApproved: true,
          businessUnitId: unitId,
          podId: null,
          roleId: recruiterRoleId,
          assignedRoleIds: [recruiterRoleId],
          customRole: {
            id: recruiterRoleId,
            name: 'Recruiter',
            systemRole: { systemKey: 'RECRUITER' },
          },
        },
      ]);
      prismaMock.pod.update.mockResolvedValue({ id: podId });
      prismaMock.user.update.mockResolvedValue({});

      const findOneSpy = jest.spyOn(podsService, 'findOne').mockResolvedValue({
        id: podId,
        name: 'POD(Backend)',
        branchId,
        branchName: 'Main',
        businessUnitId: unitId,
        businessUnitName: 'Main',
        podHeadId: newLeadId,
        podHeadName: 'New Lead',
        description: null,
        isAvailableForAssignment: true,
        members: [],
        jobsCount: 0,
        createdAt: new Date().toISOString(),
      });

      await podsService.update(podId, { podHeadId: newLeadId }, tenantId);

      // Verify demotion of former lead
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: formerLeadId },
        data: {
          roleId: recruiterRoleId,
          assignedRoleIds: [recruiterRoleId], // POD_LEAD cleanly stripped!
        },
      });

      // Verify promotion of new lead
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: newLeadId },
        data: {
          roleId: podLeadRoleId,
          assignedRoleIds: expect.arrayContaining([recruiterRoleId, podLeadRoleId]),
        },
      });
    });

    it('does not demote former lead if they still head another pod', async () => {
      prismaMock.pod.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === podId) {
          return {
            id: podId,
            name: 'POD(Backend)',
            podHeadId: formerLeadId,
            branchId,
            businessUnitId: unitId,
            description: null,
            users: [{ id: formerLeadId }],
          };
        }
        if (where?.podHeadId === formerLeadId) {
          return { id: 'other-pod-999' }; // Still leads another pod!
        }
        return null;
      });

      prismaMock.user.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === newLeadId) {
          return {
            id: newLeadId,
            roleId: recruiterRoleId,
            assignedRoleIds: [recruiterRoleId],
            branchId,
          };
        }
        return null;
      });

      prismaMock.user.findMany.mockResolvedValue([
        {
          id: newLeadId,
          fullName: 'New Lead',
          isActive: true,
          isApproved: true,
          businessUnitId: unitId,
          podId: null,
          roleId: recruiterRoleId,
          assignedRoleIds: [recruiterRoleId],
          customRole: {
            id: recruiterRoleId,
            name: 'Recruiter',
            systemRole: { systemKey: 'RECRUITER' },
          },
        },
      ]);
      prismaMock.pod.update.mockResolvedValue({ id: podId });
      prismaMock.user.update.mockResolvedValue({});

      jest.spyOn(podsService, 'findOne').mockResolvedValue({} as any);

      await podsService.update(podId, { podHeadId: newLeadId }, tenantId);

      // formerLead should NOT have been updated with RECRUITER role
      expect(prismaMock.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: formerLeadId },
        }),
      );
    });

    it('demotes pod head cleanly on pod remove()', async () => {
      prismaMock.pod.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === podId) {
          return {
            id: podId,
            podHeadId: formerLeadId,
            tenantId,
            _count: { jobPods: 0 },
          };
        }
        if (where?.podHeadId === formerLeadId) {
          return null; // No other pods
        }
        return null;
      });

      prismaMock.user.findFirst.mockResolvedValue({
        id: formerLeadId,
        roleId: podLeadRoleId,
        assignedRoleIds: [podLeadRoleId],
        branchId,
      });

      prismaMock.pod.delete.mockResolvedValue({});
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

      await podsService.remove(podId, tenantId);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: formerLeadId },
        data: {
          roleId: null,
          assignedRoleIds: [],
        },
      });
      expect(prismaMock.pod.delete).toHaveBeenCalledWith({ where: { id: podId } });
    });

    it('dispatches pod_lead_assigned email notification when pod lead is assigned', async () => {
      const emailServiceMock = {
        sendPodLeadAssignedEmail: jest.fn().mockResolvedValue({ status: 'accepted' }),
      };
      const serviceWithEmail = new PodsService(prismaMock, emailServiceMock as any);
      jest.spyOn(serviceWithEmail, 'findOne').mockResolvedValue({} as any);

      prismaMock.pod.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === podId) {
          return { id: podId, name: 'Backend Pod', podHeadId: formerLeadId, tenantId, businessUnitId: unitId, branchId };
        }
        return null;
      });
      prismaMock.user.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.id === newLeadId) {
          return {
            id: newLeadId,
            email: 'newlead@enfycon.com',
            fullName: 'New Lead',
            roleId: recruiterRoleId,
            assignedRoleIds: [recruiterRoleId],
            branchId,
          };
        }
        if (where?.id === formerLeadId) {
          return {
            id: formerLeadId,
            email: 'former@enfycon.com',
            fullName: 'Former Lead',
            roleId: podLeadRoleId,
            assignedRoleIds: [recruiterRoleId, podLeadRoleId],
            branchId,
          };
        }
        return null;
      });
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: newLeadId,
          fullName: 'New Lead',
          email: 'newlead@enfycon.com',
          isActive: true,
          isApproved: true,
          businessUnitId: unitId,
          podId: null,
          roleId: recruiterRoleId,
          assignedRoleIds: [recruiterRoleId],
          customRole: {
            id: recruiterRoleId,
            name: 'Recruiter',
            systemRole: { systemKey: 'RECRUITER' },
          },
        },
      ]);
      prismaMock.customRole.findMany.mockImplementation(async ({ where }: any) => [
        {
          id: recruiterRoleId,
          name: 'Recruiter',
          tenantId,
          systemRole: { systemKey: 'RECRUITER' },
        },
        {
          id: podLeadRoleId,
          name: 'Pod Lead',
          tenantId,
          businessUnitId: unitId,
          systemRole: { systemKey: 'POD_LEAD' },
        },
      ].filter(role => !where?.systemRole?.systemKey || role.systemRole.systemKey === where.systemRole.systemKey));
      prismaMock.tenant = { findFirst: jest.fn().mockResolvedValue({ name: 'Enfycon', domain: 'enfycon' }) };
      prismaMock.branch = { findFirst: jest.fn().mockResolvedValue({ name: 'Kolkata' }) };
      prismaMock.businessUnit.findFirst = jest.fn().mockResolvedValue({ id: unitId, name: 'India Staffing', branchId });
      prismaMock.pod.update.mockResolvedValue({});
      prismaMock.user.update.mockResolvedValue({});

      await serviceWithEmail.update(podId, { podHeadId: newLeadId }, tenantId, unitAdminUser);

      expect(emailServiceMock.sendPodLeadAssignedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          to: 'newlead@enfycon.com',
          fullName: 'New Lead',
          podName: 'Backend Pod',
          actor: unitAdminUser,
          tenantName: 'Enfycon',
        }),
      );
    });
  });
});
