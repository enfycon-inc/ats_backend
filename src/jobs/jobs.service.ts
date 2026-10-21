import { validateJobDates } from './job-dates';
import { assertUnitJobScope, managesCurrentUnit } from './unit-job-scope';
import { usesAutomaticPods } from '../business-units/pod-strategy';
import { allocateAutomaticPod } from './automatic-pod';
import { loadPocPolicy } from '../clients/poc-access';
import { normalizeJobStatus } from './job-status-contract';
import { assessCandidate } from './candidate-assessment';
import { loadAssessmentSkills, skillResolver } from './assessment-skill-dictionary';
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto } from './dtos/create-job.dto';
import { DelegateJobDto, AcceptDelegationDto, RejectDelegationDto } from './dtos/delegate-job.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { delegationTargets } from '../business-units/business-units.service';
import { listJobStaff, listJobPods, validateJobRecruiters } from './job-staffing';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { clientReadWhere } from '../clients/client-visibility';
import { resolveActiveRole } from '../auth/utils/active-role';
import { commercialFields, displayCommercialRate, positiveInteger } from './job-commercials';

export interface JobProfile {
  clientId?: string | null;
  endClientId?: string | null;
  pocId?: string | null;
  endClientPocId?: string | null;
  endClientName?: string | null;
  id: string;
  jobCode: string;
  jobTitle: string;
  businessUnit: string;
  businessUnitId?: string | null;
  client: string;
  clientJobId: string;
  state: string;
  city: string | null;
  country: string;
  type: string;
  description: string;
  skillsRequired: string[];
  secondarySkills: string[];
  jobStatus: string;
  createdOn: string;
  modifiedOn: string;
  createdAt?: string;
  updatedAt?: string;
  creatorEmail?: string | null;
  createdByUserId?: string | null;

  // Co-Sourcing fields
  isCoSourced?: boolean;
  sharedBranchIds?: string[];
  marginSplitAmPct?: number | null;
  marginSplitRecPct?: number | null;

  // Rates & terms
  visaType: string;
  clientBillRate: string;
  payRate: string;
  taxTerms: string;

  // Client hierarchy
  

  // Staffing metrics
  noOfPositions: number;
  submissionRequired: number;
  submissionDone: number;
  priority: string;

  // Schedule
  workMode: string;
  startDate: string | null;
  endDate: string | null;
  hoursPerWeek: number;
  duration: string;

  // People
  accountManagerId: string;
  accountManagerName?: string | null;
  accountManagerEmail?: string | null;
  recruitmentManagerId: string;
  recruitmentManager: string;
  recruiterId?: string;
  recruiterIds?: string[];
  recruiterDetails?: AssignedRecruiterProfile[];
  recruiter: string;
  createdBy: string;

  // Experience & education
  industry: string;
  degree: string;
  expMin: number;
  expMax: number;

  // Computed
  submissionsCount: number;
  agingDays: number;
  pipeline: { applied: number; interviewing: number; offered: number };

  podId?: string;
  podIds?: string[];
  podName?: string;
  branchId?: string;
  branchName?: string;
  branchCode?: string;
  respondBy?: string | null;
  noticePeriod?: string;
  market?: string;

  // Approval Workflow
  approvalStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  assignedApproverId?: string | null;
  assignedApproverName?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;

  // Branch Timing Snapshot
  jobTimezone?: string;
  shiftTiming?: string;
  timingSnapshotAt?: string | null;
}

export interface AssignedRecruiterProfile {
  id: string;
  fullName: string;
  email?: string | null;
  avatar?: string | null;
}

/** A single candidate ranked against a job requisition. */
export interface CandidateMatch {
  candidateId: string;
  fullName: string;
  email: string;
  phone: string;
  currentTitle: string;
  source: string;
  workAuthorization: string;
  experienceYears: number;
  /** 0-100 overall fit. */
  assessment?: ReturnType<typeof assessCandidate>;
  matchScore: number;
  matchTier: 'Strong' | 'Good' | 'Fair' | 'Low';
  matchedSkills: string[];
  missingSkills: string[];
  currentCTC?: number | null;
  expectedCTC?: number | null;
  noticePeriodDays?: number;
  servingNotice?: boolean;
  lastWorkingDay?: string | null;
  preferredLocations?: string[];
  /** How the score was composed, for transparency in the UI. */
  breakdown: {
    primarySkills: string;   // e.g. "4/5"
    secondarySkills: string; // e.g. "1/3"
    experienceFit: number | null;   // 0-100
    semantic: number | null; // 0-100 or null if parser offline
  };
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Resolve any user identifier (UUID, email, name, prefixed 'rec:uuid'/'dh:uuid') to a pure user UUID.
   */
  async resolveUserUuid(identifier?: string | null, tenantId?: string): Promise<string | null> {
    if (!identifier || typeof identifier !== 'string') return null;
    const clean = identifier.replace(/^(rec:|dh:|pod:|user:)/i, '').trim();
    if (!clean || clean === 'N/A' || clean.toLowerCase() === 'all' || clean.toLowerCase() === 'none' || clean.toLowerCase() === 'unassigned') {
      return null;
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
    if (isUuid) {
      if (!tenantId) return clean;
      const user = await this.prisma.user.findFirst({
        where: { id: clean, tenantId },
        select: { id: true },
      });
      if (user) return user.id;
    }

    if (tenantId) {
      const user = await this.prisma.user.findFirst({
        where: {
          tenantId,
          OR: [
            { email: { equals: clean, mode: 'insensitive' } },
            { fullName: { equals: clean, mode: 'insensitive' } },
            { fullName: { contains: clean, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (user) return user.id;
    }
    return null;
  }

  /**
   * Find all Delivery Head / Reviewer user IDs for a branch or tenant dynamically from the database
   * using role permissions, custom roles, and branch manager assignments.
   */
  async getDeliveryHeadIds(tenantId: string, branchId?: string | null): Promise<string[]> {
    try {
      let sql = `
        SELECT DISTINCT u.id 
        FROM ats.users u
        LEFT JOIN ats.custom_roles cr ON (
          cr.id = u.role_id 
          OR cr.id = ANY(COALESCE(u.assigned_role_ids, '{}'))
        )
        LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id
        LEFT JOIN ats.branches b ON b.id = u.branch_id
        WHERE u.tenant_id = $1 AND u.is_active = true
          AND (
            cr.permissions ?| array['job:approve', 'branch_admin:manage', 'submission:internal_screening']
            OR (b.manager_id = u.id)
            OR UPPER(COALESCE(sr.system_key, '')) IN ('DELIVERY_HEAD', 'DELIVERYHEAD', 'BRANCH_ADMIN')
            OR u.id IN (SELECT DISTINCT job_reviewer_id FROM ats.users WHERE tenant_id = $1 AND job_reviewer_id IS NOT NULL)
          )
      `;
      const params: any[] = [tenantId];
      if (branchId) {
        params.push(branchId);
        sql += ` AND (
          u.branch_id = $2 
          OR $2 = ANY(COALESCE(u.assigned_branch_ids, '{}'))
          OR cr.permissions ?| array['job:view_all_branches', 'tenant:settings', 'tenant:manage']
          OR UPPER(COALESCE(sr.system_key, '')) = 'DELIVERY_HEAD'
        )`;
      }
      const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);
      return rows.map((r: any) => r.id);
    } catch (e: any) {
      this.logger.warn(`Failed to get delivery head IDs: ${e.message}`);
      return [];
    }
  }

  async getNextJobCode(tenantId: string, branchId?: string | null, shiftInput?: string | null, offset = 0, businessUnitId?: string | null): Promise<string> {
    // 1. Fetch Tenant and default pattern
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { jobCodePattern: true, enforceJobCodePattern: true },
    });
    
    let pattern = tenant?.jobCodePattern || '{BRANCH}-{UNIT}-{YYMMDD}-{SEQ}';
    const enforceTenantPattern = tenant?.enforceJobCodePattern || false;

    // 2. Resolve Business Unit
    let unitCode = 'GEN';
    let branchMarket = '';
    let buBranchId: string | null = null;

    if (businessUnitId) {
      const bu = await this.prisma.businessUnit.findUnique({
        where: { id: businessUnitId },
        include: { marketSegment: true },
      });
      if (bu) {
        if (bu.jobCodePattern && !enforceTenantPattern) {
           pattern = bu.jobCodePattern;
        }
        unitCode = bu.code || (bu as any).marketSegment?.code || 'GEN';
        branchMarket = (bu as any).marketSegment?.code || '';
        buBranchId = bu.branchId;
      }
    }

    // 3. Resolve Branch Code (manual code set by admin, or first 3 letters of branch name, or 'GEN')
    let branchCode = 'GEN';
    let branchName = '';
    const lookupId = branchId ? branchId.trim() : buBranchId ? buBranchId : '';

    let branch: any = null;
    if (lookupId && lookupId !== 'null' && lookupId !== 'undefined') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookupId);
      branch = await this.prisma.branch.findFirst({
        where: {
          tenantId,
          OR: [
            ...(isUuid ? [{ id: lookupId }] : []),
            { name: { equals: lookupId, mode: 'insensitive' } },
            { code: { equals: lookupId, mode: 'insensitive' } },
            { name: { contains: lookupId, mode: 'insensitive' } },
          ],
        },
        select: { id: true, code: true, name: true, market: true },
      });
    }

    if (!branch) {
      branch = await this.prisma.branch.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, code: true, name: true, market: true },
      });
    }

    if (branch) {
      branchMarket = branchMarket || branch.market || '';
      branchName = branch.name || '';
      if (branch.code && branch.code.trim().length > 0) {
        branchCode = branch.code.trim().toUpperCase();
      } else if (branch.name && branch.name.trim().length > 0) {
        branchCode = branch.name.trim().replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
      }
    }

    // 4. Resolve Shift Code ('D' for Day, 'N' for Night)
    let shiftCode = 'D';
    if (shiftInput) {
      const norm = shiftInput.trim().toUpperCase();
      if (norm.startsWith('N') || norm.includes('NIGHT') || norm.includes('US')) {
        shiftCode = 'N';
      } else {
        shiftCode = 'D';
      }
    } else if (
      branchMarket.toUpperCase() === 'USA' ||
      branchMarket.toUpperCase() === 'US' ||
      branchName.toLowerCase().includes('us') ||
      branchName.toLowerCase().includes('night')
    ) {
      shiftCode = 'N';
    } else {
      const currentHour = new Date().getHours();
      shiftCode = (currentHour >= 18 || currentHour < 6) ? 'N' : 'D';
    }

    // 5. Format Date components
    const date = new Date();
    const yy = date.getFullYear().toString().slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yymmdd = `${yy}${mm}${dd}`;

    // 6. Build base pattern (without sequence) to search for max sequence
    let basePatternStr = pattern
      .replace('{BRANCH}', branchCode)
      .replace('{UNIT}', unitCode)
      .replace('{YYMMDD}', yymmdd)
      .replace('{YYMM}', `${yy}${mm}`)
      .replace('{YY}', yy)
      .replace('{MM}', mm)
      .replace('{DD}', dd)
      .replace('{SHIFT}', shiftCode);
      
    // Parse sequence padding length from {SEQ:X} or {SEQ}
    let seqPad = 3;
    let seqPlaceholder = '{SEQ}';
    const seqMatchInfo = basePatternStr.match(/\{SEQ(?:[:]?(\d+))?\}/);
    if (seqMatchInfo) {
       seqPlaceholder = seqMatchInfo[0];
       if (seqMatchInfo[1]) {
           seqPad = parseInt(seqMatchInfo[1], 10);
       }
    }

    // Find the prefix before sequence placeholder to query max sequence
    const seqIndex = basePatternStr.indexOf(seqPlaceholder);
    const prefix = seqIndex >= 0 ? basePatternStr.substring(0, seqIndex) : basePatternStr;
    const suffix = seqIndex >= 0 ? basePatternStr.substring(seqIndex + seqPlaceholder.length) : '';

    // 7. Find highest sequence for this exact prefix
    const jobs = await this.prisma.job.findMany({
      where: {
        tenantId,
        jobCode: { startsWith: prefix },
      },
      select: { jobCode: true },
    });

    let maxSequence = 0;
    for (const row of jobs) {
      const jobCodeStr = row.jobCode || '';
      let seqPart = jobCodeStr.substring(prefix.length);
      if (suffix && seqPart.endsWith(suffix)) {
        seqPart = seqPart.substring(0, seqPart.length - suffix.length);
      }
      
      const seqMatch = seqPart.match(/^(\d+)$/);
      if (seqMatch) {
         const seq = parseInt(seqMatch[1], 10);
         if (seq > maxSequence) {
            maxSequence = seq;
         }
      } else {
        const legacyMatch = seqPart.match(/(\d+)$/);
        if (legacyMatch) {
            const seq = parseInt(legacyMatch[1], 10);
            if (seq > maxSequence) {
                maxSequence = seq;
            }
        }
      }
    }

    const nextSeq = maxSequence + 1 + offset;
    const seqStr = String(nextSeq).padStart(seqPad, '0');
    
    if (seqIndex >= 0) {
      return basePatternStr.replace(seqPlaceholder, seqStr);
    } else {
       return `${basePatternStr}-${seqStr}`;
    }
  }

  /**
   * Create a new job requisition
   */
  async listJobStaff(actor: AuthUser, tenantId: string, branchId?: string, unitId?: string, jobId?: string) {
    return listJobStaff(this.prisma, actor, tenantId, branchId, unitId, jobId);
  }

  async listJobPods(actor: AuthUser, tenantId: string, branchId?: string, unitId?: string) {
    return listJobPods(this.prisma, actor, tenantId, branchId, unitId);
  }

  private assertDraftScope(tenantId: string, actor: AuthUser, branchId: string | null | undefined, unitId: string | null | undefined) {
    const perms = actor.permissions || [];
    if (actor.tenantId !== tenantId) throw new ForbiddenException('Workspace unavailable.');
    if (perms.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(p))) return;
    if (!branchId || branchId !== actor.branchId || (!perms.includes('branch_admin:manage') && (!unitId || unitId !== actor.businessUnitId))) {
      throw new ForbiddenException('The draft is outside your assigned workspace.');
    }
  }

  private async assertDraftAccess(job: any, tenantId: string, actor: AuthUser) {
    if (job.tenantId !== tenantId) throw new ForbiddenException('Draft unavailable in this workspace.');
    this.assertDraftScope(tenantId, actor, job.branchId, job.businessUnitId);
    if (job.deletedAt || job.status !== 'Draft') throw new BadRequestException('Only draft jobs can be saved or published through this action.');
    const perms = actor.permissions || [];
    const elevated = perms.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage', '*', 'branch_admin:manage', 'unit_admin:manage'].includes(p));
    const isOwner = job.accountManagerId === actor.dbId;
    const isCreator = job.createdByUserId === actor.dbId;
    const activeGrant = !isOwner && isCreator && job.accountManagerId ? await this.prisma.jobCreationGrant.findFirst({
      where: { tenantId, accountManagerId: job.accountManagerId, delegateUserId: actor.dbId, revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true },
    }) : null;
    if (!isOwner && !isCreator && !elevated) {
      throw new ForbiddenException('You can only change your own drafts.');
    }
    if (!isOwner && isCreator && !activeGrant && !elevated) {
      throw new ForbiddenException('Your authorization to create for this colleague has been revoked.');
    }
  }

  private async assertCanCreateFor(actor: AuthUser, tenantId: string, accountManagerId: string | null, existingGrantUse = false) {
    if (actor.tenantId && actor.tenantId !== tenantId) throw new ForbiddenException('Workspace unavailable.');
    const permissions = actor.permissions || [];
    const canCreateJobs = permissions.includes('job:create') || permissions.includes('platform:manage') || permissions.includes('*');
    if (accountManagerId === actor.dbId && canCreateJobs) return;
    if (!accountManagerId || accountManagerId === actor.dbId) {
      throw new ForbiddenException('You need job creation access or an active colleague authorization to create this job.');
    }
    const [owner, grant] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: accountManagerId, tenantId, isActive: true, isApproved: true }, select: { id: true, roleId: true, assignedRoleIds: true } }),
      this.prisma.jobCreationGrant.findFirst({ where: { tenantId, accountManagerId, delegateUserId: actor.dbId, revokedAt: null }, select: { id: true, expiresAt: true, maxJobs: true, jobsUsed: true } }),
    ]);
    if (!owner || !grant || (grant.expiresAt && grant.expiresAt <= new Date()) || (!existingGrantUse && grant.maxJobs !== null && grant.jobsUsed >= grant.maxJobs)) throw new ForbiddenException('Your job creation access is expired or its job limit has been reached.');
    const roleIds = [...new Set([owner.roleId, ...(owner.assignedRoleIds || [])].filter(Boolean))] as string[];
    const roles = roleIds.length ? await this.prisma.customRole.findMany({ where: { tenantId, id: { in: roleIds } }, select: { permissions: true } }) : [];
    if (!roles.some(role => Array.isArray(role.permissions) && (role.permissions.includes('job:create') || role.permissions.includes('*') || role.permissions.includes('platform:manage')))) {
      throw new ForbiddenException('This colleague no longer has permission to own job requisitions.');
    }
    return grant;
  }

  private async delegatedClientContext(actor: AuthUser, tenantId: string, accountManagerId: string) {
    if (!accountManagerId || accountManagerId === actor.dbId) throw new ForbiddenException('Delegated client access requires an active colleague authorization.');
    await this.assertCanCreateFor(actor, tenantId, accountManagerId);
    const owner = await this.prisma.user.findFirst({
      where: { id: accountManagerId, tenantId, isActive: true, isApproved: true },
      select: { id: true, email: true, fullName: true, roleId: true, assignedRoleIds: true, branchId: true, businessUnitId: true, podId: true },
    });
    if (!owner) throw new ForbiddenException('The job owner is unavailable.');
    const scopedOwner = await resolveActiveRole(this.prisma, {
      dbId: owner.id, tenantId, email: owner.email, fullName: owner.fullName,
      branchId: owner.branchId, businessUnitId: owner.businessUnitId, podId: owner.podId,
    } as AuthUser, undefined);
    const readScope = await clientReadWhere(this.prisma, tenantId, scopedOwner);
    return { owner: scopedOwner as AuthUser, readScope };
  }

  async listDelegatedJobClients(actor: AuthUser, accountManagerId: string, search?: string) {
    const { readScope } = await this.delegatedClientContext(actor, actor.tenantId, accountManagerId);
    const searchTerm = search?.trim().slice(0, 100);
    const rows = await this.prisma.client.findMany({
      where: { AND: [readScope, { deletedAt: null }, ...(searchTerm ? [{ clientName: { contains: searchTerm, mode: 'insensitive' as const } }] : [])] },
      select: { id: true, clientName: true, clientShortName: true, market: true, country: true, currency: true, commissionPercentage: true, clientCode: true, state: true, city: true, businessUnit: true, primaryBusinessUnit: true, status: true, approvalStatus: true },
      orderBy: { clientName: 'asc' }, take: 250,
    });
    return rows.map(client => ({ ...client, client_name: client.clientName, client_short_name: client.clientShortName }));
  }

  async listDelegatedJobClientContacts(actor: AuthUser, accountManagerId: string, clientId: string) {
    const { owner, readScope } = await this.delegatedClientContext(actor, actor.tenantId, accountManagerId);
    const client = await this.prisma.client.findFirst({ where: { AND: [readScope, { id: clientId, deletedAt: null }] }, select: { id: true } });
    if (!client) throw new ForbiddenException('The selected client is outside the job owner’s access scope.');
    const policy = await loadPocPolicy(this.prisma, actor.tenantId);
    const contacts = await this.prisma.clientContact.findMany({
      where: { tenantId: actor.tenantId, clientId, ...(!policy?.otherOwnerPocsVisible ? { createdBy: owner.dbId } : {}) },
      select: { id: true, name: true, designation: true, email: true, phone: true, isPrimary: true, createdBy: true },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
    const myContacts = contacts.filter(contact => contact.createdBy === owner.dbId).map(({ createdBy: _createdBy, ...contact }) => contact);
    const otherContacts = policy?.otherOwnerPocsVisible ? contacts.filter(contact => contact.createdBy !== owner.dbId).map(({ createdBy: _createdBy, ...contact }) => contact) : [];
    return { myContacts, otherContacts };
  }

  private canManageJobOwnerScope(actor: AuthUser, owner: { branchId?: string | null; businessUnitId?: string | null }) {
    const permissions = actor.permissions || [];
    if (permissions.some(permission => ['tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(permission))) return true;
    if (!permissions.includes('job:manage_creation_access') || !actor.branchId || owner.branchId !== actor.branchId) return false;
    const isDeliveryHead = [actor.systemRole, ...(actor.roles || [])].some(role => String(role || '').toUpperCase().replace(/[\s_-]+/g, '') === 'DELIVERYHEAD');
    if (permissions.includes('branch_admin:manage') || isDeliveryHead) return true;
    return permissions.includes('unit_admin:manage') && !!actor.businessUnitId && owner.businessUnitId === actor.businessUnitId;
  }

  private canManageJobCreationGrants(actor: AuthUser) {
    const permissions = actor.permissions || [];
    return permissions.some(permission => ['job:manage_creation_access', 'tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(permission));
  }

  private hasTenantWideJobCreationManagement(actor: AuthUser) {
    return (actor.permissions || []).some(permission => ['tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(permission));
  }

  private shouldRequireJobApproval(dto: CreateJobDto, requiresApprovalGate: boolean, clientApproved: boolean, delegated: boolean) {
    return delegated || dto.approvalStatus === 'PENDING_APPROVAL' || dto.status === 'Pending Approval' || requiresApprovalGate || !clientApproved;
  }

  async listJobCreationTargets(actor: AuthUser) {
    const grants = await this.prisma.jobCreationGrant.findMany({
      where: { tenantId: actor.tenantId, delegateUserId: actor.dbId, revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        accountManager: { isActive: true, isApproved: true } },
      select: { id: true, accountManagerId: true, expiresAt: true, maxJobs: true, jobsUsed: true, accountManager: { select: { fullName: true, email: true, branchId: true, businessUnitId: true } } },
      orderBy: { accountManager: { fullName: 'asc' } },
    });
    return grants.filter(grant => grant.maxJobs === null || grant.jobsUsed < grant.maxJobs)
      .map(grant => ({ id: grant.accountManagerId, name: grant.accountManager.fullName, email: grant.accountManager.email, branchId: grant.accountManager.branchId, businessUnitId: grant.accountManager.businessUnitId }));
  }

  async listJobCreationGrantPeople(actor: AuthUser, requestedOwnerId?: string, search?: string) {
    const isManager = this.canManageJobCreationGrants(actor);
    const canManageOwn = (actor.permissions || []).includes('job:grant_creation_delegate');
    if (!isManager && !canManageOwn) throw new ForbiddenException('You cannot manage job creation access.');
    const ownerId = requestedOwnerId || actor.dbId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) throw new BadRequestException('Select a valid account manager.');
    if (!isManager && ownerId !== actor.dbId) throw new ForbiddenException('You can manage access only for your own jobs.');
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: actor.tenantId, isActive: true, isApproved: true },
      select: { id: true, branchId: true, businessUnitId: true },
    });
    if (!owner || (isManager && !this.canManageJobOwnerScope(actor, owner))) throw new ForbiddenException('The selected job owner is outside your staff-management scope.');
    if (!owner.branchId || !owner.businessUnitId) return [];
    const searchTerm = search?.trim().slice(0, 100);
    return this.prisma.user.findMany({
      where: { tenantId: actor.tenantId, isActive: true, isApproved: true, id: { not: actor.dbId },
        branchId: owner.branchId, businessUnitId: owner.businessUnitId,
        ...(searchTerm ? { OR: [
          { fullName: { contains: searchTerm, mode: 'insensitive' } },
          { email: { contains: searchTerm, mode: 'insensitive' } },
        ] } : {}) },
      select: { id: true, fullName: true, email: true, branchId: true, businessUnitId: true },
      orderBy: { fullName: 'asc' },
      take: searchTerm ? 50 : 250,
    });
  }

  async listJobCreationGrantOwners(actor: AuthUser, search?: string) {
    const permissions = actor.permissions || [];
    if (!this.canManageJobCreationGrants(actor)) throw new ForbiddenException('Only an authorized administrator can select another job owner.');
    const tenantWide = this.hasTenantWideJobCreationManagement(actor);
    const isDeliveryHead = [actor.systemRole, ...(actor.roles || [])].some(role => String(role || '').toUpperCase().replace(/[\s_-]+/g, '') === 'DELIVERYHEAD');
    if (!tenantWide && (!actor.branchId || (!permissions.includes('branch_admin:manage') && !isDeliveryHead && (!permissions.includes('unit_admin:manage') || !actor.businessUnitId)))) return [];
    const searchTerm = search?.trim().slice(0, 100);
    const users = await this.prisma.user.findMany({
      where: { tenantId: actor.tenantId, isActive: true, isApproved: true,
        ...(searchTerm ? { OR: [
          { fullName: { contains: searchTerm, mode: 'insensitive' } },
          { email: { contains: searchTerm, mode: 'insensitive' } },
        ] } : {}),
        ...(!tenantWide ? { branchId: actor.branchId || undefined, ...(permissions.includes('branch_admin:manage') || isDeliveryHead ? {} : { businessUnitId: actor.businessUnitId || undefined }) } : {}) },
      select: { id: true, fullName: true, email: true, branchId: true, businessUnitId: true, roleId: true, assignedRoleIds: true },
      orderBy: { fullName: 'asc' },
      take: searchTerm ? 100 : 250,
    });
    const roleIds = [...new Set(users.flatMap(user => [user.roleId, ...(user.assignedRoleIds || [])].filter(Boolean)))] as string[];
    const roles = roleIds.length ? await this.prisma.customRole.findMany({ where: { tenantId: actor.tenantId, id: { in: roleIds } }, select: { id: true, permissions: true } }) : [];
    const createPermissions = new Map(roles.map(role => [role.id, Array.isArray(role.permissions) ? role.permissions : []]));
    return users.filter(user => [user.roleId, ...(user.assignedRoleIds || [])].some(roleId => {
      const rolePermissions = createPermissions.get(roleId as string) || [];
      return rolePermissions.includes('job:create') || rolePermissions.includes('*') || rolePermissions.includes('platform:manage');
    })).map(({ id, fullName, email, branchId, businessUnitId }) => ({ id, fullName, email, branchId, businessUnitId }));
  }

  async listJobCreationGrants(actor: AuthUser, requestedOwnerId?: string) {
    const permissions = actor.permissions || [];
    const isManager = this.canManageJobCreationGrants(actor);
    if (!isManager && !permissions.includes('job:grant_creation_delegate')) throw new ForbiddenException('You cannot manage job creation access.');
    const ownerId = requestedOwnerId || actor.dbId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) throw new BadRequestException('Select a valid account manager.');
    if (!isManager && ownerId !== actor.dbId) throw new ForbiddenException('You can manage access only for your own jobs.');
    if (isManager && ownerId !== actor.dbId) {
      const owner = await this.prisma.user.findFirst({ where: { id: ownerId, tenantId: actor.tenantId, isActive: true, isApproved: true }, select: { branchId: true, businessUnitId: true } });
      if (!owner || !this.canManageJobOwnerScope(actor, owner)) throw new ForbiddenException('The selected job owner is outside your staff-management scope.');
    }
    return this.prisma.jobCreationGrant.findMany({
      where: { tenantId: actor.tenantId, accountManagerId: ownerId },
      select: { id: true, revokedAt: true, expiresAt: true, maxJobs: true, jobsUsed: true, createdAt: true, delegateUser: { select: { id: true, fullName: true, email: true } }, grantedBy: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createJobCreationGrant(actor: AuthUser, accountManagerId: string, delegateUserId: string, options: { expiresAt?: string | null; maxJobs?: number | null } = {}) {
    const permissions = actor.permissions || [];
    const isManager = this.canManageJobCreationGrants(actor);
    if (!isManager && (!permissions.includes('job:grant_creation_delegate') || accountManagerId !== actor.dbId)) throw new ForbiddenException('Only the account manager or an authorized administrator can grant this access.');
    const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
    if (!isUuid(accountManagerId) || !isUuid(delegateUserId)) throw new BadRequestException('Select valid colleagues.');
    if (!accountManagerId || !delegateUserId || accountManagerId === delegateUserId) throw new BadRequestException('Select a valid colleague.');
    let expiresAt: Date | null = null;
    if (options.expiresAt !== undefined && options.expiresAt !== null && options.expiresAt !== '') {
      expiresAt = new Date(options.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new BadRequestException('Expiry must be a valid future date and time.');
    }
    const maxJobs = options.maxJobs === undefined || options.maxJobs === null || options.maxJobs === ('' as any) ? null : Number(options.maxJobs);
    if (maxJobs !== null && (!Number.isSafeInteger(maxJobs) || maxJobs < 1)) throw new BadRequestException('The job limit must be a positive whole number.');
    const [owner, delegate] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: accountManagerId, tenantId: actor.tenantId, isActive: true, isApproved: true }, select: { id: true, branchId: true, businessUnitId: true, roleId: true, assignedRoleIds: true } }),
      this.prisma.user.findFirst({ where: { id: delegateUserId, tenantId: actor.tenantId, isActive: true, isApproved: true }, select: { id: true, branchId: true, businessUnitId: true } }),
    ]);
    if (!owner || !delegate) throw new BadRequestException('Both colleagues must be active users in this workspace.');
    if (isManager && !this.canManageJobOwnerScope(actor, owner)) throw new ForbiddenException('The selected job owner is outside your staff-management scope.');
    const ownerRoleIds = [...new Set([owner.roleId, ...(owner.assignedRoleIds || [])].filter(Boolean))] as string[];
    const ownerRoles = ownerRoleIds.length ? await this.prisma.customRole.findMany({ where: { tenantId: actor.tenantId, id: { in: ownerRoleIds } }, select: { permissions: true } }) : [];
    if (!ownerRoles.some(role => Array.isArray(role.permissions) && (role.permissions.includes('job:create') || role.permissions.includes('*') || role.permissions.includes('platform:manage')))) {
      throw new BadRequestException('The selected job owner does not have job creation permission.');
    }
    if (!isManager && owner.id !== actor.dbId) throw new ForbiddenException('You can grant access only for your own jobs.');
    if (delegate.branchId !== owner.branchId || delegate.businessUnitId !== owner.businessUnitId) throw new ForbiddenException('Job creation access is limited to colleagues in the same business unit.');
    const grant = await this.prisma.jobCreationGrant.upsert({
      where: { tenantId_accountManagerId_delegateUserId: { tenantId: actor.tenantId, accountManagerId, delegateUserId } },
      create: { tenantId: actor.tenantId, accountManagerId, delegateUserId, grantedByUserId: actor.dbId, expiresAt, maxJobs, jobsUsed: 0 },
      update: { revokedAt: null, grantedByUserId: actor.dbId, expiresAt, maxJobs, jobsUsed: 0, updatedAt: new Date() },
      select: { id: true, accountManagerId: true, delegateUserId: true, revokedAt: true, expiresAt: true, maxJobs: true, jobsUsed: true },
    });
    await this.prisma.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.dbId, actorEmail: actor.email, action: 'JOB_CREATION_ACCESS_GRANTED', targetType: 'user', targetId: delegateUserId, details: { accountManagerId, expiresAt: expiresAt?.toISOString() || null, maxJobs } } });
    return grant;
  }

  async revokeJobCreationGrant(actor: AuthUser, grantId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantId || '')) throw new BadRequestException('Select valid job creation access.');
    const grant = await this.prisma.jobCreationGrant.findFirst({ where: { id: grantId, tenantId: actor.tenantId }, select: { id: true, accountManagerId: true, delegateUserId: true, revokedAt: true, accountManager: { select: { branchId: true, businessUnitId: true } } } });
    if (!grant) throw new NotFoundException('Job creation access not found.');
    const permissions = actor.permissions || [];
    const isManager = this.canManageJobCreationGrants(actor);
    if (!isManager && (!permissions.includes('job:grant_creation_delegate') || grant.accountManagerId !== actor.dbId)) throw new ForbiddenException('Only the account manager or an authorized administrator can revoke this access.');
    if (isManager && !this.canManageJobOwnerScope(actor, grant.accountManager)) throw new ForbiddenException('The selected job owner is outside your staff-management scope.');
    if (grant.revokedAt) return;
    await this.prisma.jobCreationGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.dbId, actorEmail: actor.email, action: 'JOB_CREATION_ACCESS_REVOKED', targetType: 'user', targetId: grant.delegateUserId, details: { accountManagerId: grant.accountManagerId } } });
  }

  async updateJobCreationGrant(actor: AuthUser, grantId: string, options: { expiresAt?: string | null; maxJobs?: number | null } = {}) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantId || '')) throw new BadRequestException('Select valid job creation access.');
    let expiresAt: Date | null | undefined;
    if (options.expiresAt !== undefined) {
      expiresAt = null;
      if (options.expiresAt !== null && options.expiresAt !== '') {
        expiresAt = new Date(options.expiresAt);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new BadRequestException('Expiry must be a valid future date and time.');
      }
    }
    const maxJobs = options.maxJobs === undefined ? undefined : options.maxJobs === null || options.maxJobs === ('' as any) ? null : Number(options.maxJobs);
    if (maxJobs !== null && maxJobs !== undefined && (!Number.isSafeInteger(maxJobs) || maxJobs < 1)) throw new BadRequestException('The job limit must be a positive whole number.');

    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ats.job_creation_grants WHERE id = ${grantId}::uuid AND tenant_id = ${actor.tenantId}::uuid FOR UPDATE`;
      const grant = await tx.jobCreationGrant.findFirst({
        where: { id: grantId, tenantId: actor.tenantId },
        select: { id: true, accountManagerId: true, delegateUserId: true, revokedAt: true, expiresAt: true, maxJobs: true, jobsUsed: true, accountManager: { select: { branchId: true, businessUnitId: true } } },
      });
      if (!grant) throw new NotFoundException('Job creation access not found.');
      const permissions = actor.permissions || [];
      const isManager = this.canManageJobCreationGrants(actor);
      if (!isManager && (!permissions.includes('job:grant_creation_delegate') || grant.accountManagerId !== actor.dbId)) throw new ForbiddenException('Only the account manager or an authorized administrator can edit this access.');
      if (isManager && !this.canManageJobOwnerScope(actor, grant.accountManager)) throw new ForbiddenException('The selected job owner is outside your staff-management scope.');
      if (grant.revokedAt) throw new BadRequestException('Revoked access cannot be edited. Grant access again to restore it.');
      if (maxJobs !== null && maxJobs !== undefined && maxJobs < grant.jobsUsed) throw new BadRequestException(`The job limit cannot be lower than the ${grant.jobsUsed} jobs already used.`);

      const updateData = {
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(maxJobs !== undefined ? { maxJobs } : {}),
        updatedAt: new Date(),
      };
      const updated = await tx.jobCreationGrant.update({
        where: { id: grant.id }, data: updateData,
        select: { id: true, accountManagerId: true, delegateUserId: true, revokedAt: true, expiresAt: true, maxJobs: true, jobsUsed: true },
      });
      await tx.auditLog.create({ data: {
        tenantId: actor.tenantId, actorId: actor.dbId, actorEmail: actor.email, action: 'JOB_CREATION_ACCESS_UPDATED', targetType: 'user', targetId: grant.delegateUserId,
        details: {
          accountManagerId: grant.accountManagerId,
          previousExpiresAt: grant.expiresAt?.toISOString() || null,
          expiresAt: expiresAt === undefined ? grant.expiresAt?.toISOString() || null : expiresAt?.toISOString() || null,
          previousMaxJobs: grant.maxJobs,
          maxJobs: maxJobs === undefined ? grant.maxJobs : maxJobs,
        },
      } });
      return updated;
    });
  }

  private async resolveSelectedClients(dto: CreateJobDto, tenantId: string, actor: AuthUser, accountManagerId?: string | null) {
    if (!dto.client && !dto.clientId && !dto.endClientName && !dto.endClientId && !dto.pocId && !dto.endClientPocId) return;
    const delegated = accountManagerId && accountManagerId !== actor.dbId
      ? await this.delegatedClientContext(actor, tenantId, accountManagerId) : null;
    const clientActor = delegated?.owner || actor;
    const scope = delegated?.readScope || await clientReadWhere(this.prisma, tenantId, actor);
    for (const [nameKey, idKey] of [['client', 'clientId'], ['endClientName', 'endClientId']] as const) {
      const id = dto[idKey];
      const name = dto[nameKey];
      if (!id && !name) { dto[idKey] = undefined; continue; }
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException('Select a valid client.');
      const client = await this.prisma.client.findFirst({
        where: { AND: [scope, { deletedAt: null }, id ? { id } : { clientName: { equals: name!.trim(), mode: 'insensitive' } }] },
        select: { id: true, clientName: true },
      });
      if (!client) throw new ForbiddenException('The selected client is unavailable in this workspace. Select an existing client or add one through the client form.');
      dto[idKey] = client.id;
      dto[nameKey] = client.clientName;
    }
    const pocPolicy = await loadPocPolicy(this.prisma, tenantId);
    for (const [contactId, clientId] of [[dto.pocId, dto.clientId], [dto.endClientPocId, dto.endClientId]]) {
      if (!contactId) continue;
      const contact = clientId && await this.prisma.clientContact.findFirst({ where: { id: contactId, clientId, tenantId, ...(!pocPolicy?.otherOwnerPocsVisible ? { createdBy: clientActor.dbId } : {}) }, select: { id: true } });
      if (!contact) throw new BadRequestException('The selected contact does not belong to this client.');
    }
  }

  async saveDraft(dto: CreateJobDto, tenantId: string, actor: AuthUser, branchId?: string | null, id?: string) {
    validateJobDates(dto.startDate, dto.endDate);
    const draftId = id || dto.draftId;
    if (!draftId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) {
      throw new BadRequestException('A valid draft request identifier is required.');
    }
    const existing = await this.prisma.job.findFirst({ where: { id: draftId } });
    if (existing) {
      await this.assertDraftAccess(existing, tenantId, actor);
      await this.assertCanCreateFor(actor, tenantId, existing.accountManagerId, true);
      this.assertDraftScope(tenantId, actor, dto.branchId ?? existing.branchId, dto.businessUnitId ?? existing.businessUnitId);
    } else if (id) throw new NotFoundException('Draft not found.');
    else this.assertDraftScope(tenantId, actor, dto.branchId || branchId, dto.businessUnitId);
    await this.resolveSelectedClients(dto, tenantId, actor, existing?.accountManagerId || dto.accountManagerId);
    const payload = { ...dto, draftId, status: 'Draft', title: dto.title || '', type: dto.type || 'Full Time', description: dto.description || '', skillsRequired: dto.skillsRequired || [] };
    return existing
      ? this.updateJob(draftId, payload, tenantId, actor, 'draft')
      : this.createJob(payload, tenantId, actor.dbId, branchId, actor, true);
  }

  async publishDraft(id: string, dto: CreateJobDto, tenantId: string, actor: AuthUser) {
    const job = await this.prisma.job.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!job) throw new NotFoundException('Draft not found.');
    await this.assertDraftAccess(job, tenantId, actor);
    await this.assertCanCreateFor(actor, tenantId, job.accountManagerId, true);
    this.assertDraftScope(tenantId, actor, dto.branchId ?? job.branchId, dto.businessUnitId ?? job.businessUnitId);
    if ((dto.title || '').trim().length < 3 || (dto.description || '').trim().length < 10 || !dto.client || !dto.payRate || !dto.clientBillRate) {
      throw new BadRequestException('Complete the required job fields before publishing.');
    }
    await this.resolveSelectedClients(dto, tenantId, actor, job.accountManagerId);
    const clients = await this.prisma.client.findMany({ where: { tenantId, id: { in: [dto.clientId, dto.endClientId].filter((value): value is string => !!value) } }, select: { status: true, approvalStatus: true } });
    const creator = await this.prisma.user.findUnique({ where: { id: job.accountManagerId || actor.dbId }, select: { jobReviewerId: true } });
    const direct = (actor.permissions || []).some(p => ['job:publish_direct', 'tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(p));
    const pending = !direct || clients.some(c => ['Pending Approval', 'Rejected'].includes(c.status) || ['PENDING_APPROVAL', 'REJECTED'].includes(c.approvalStatus || ''));
    const assignedApproverId = creator?.jobReviewerId || job.assignedApproverId;
    return this.updateJob(id, { ...dto, status: pending ? 'Pending Approval' : 'Active', approvalStatus: pending ? 'PENDING_APPROVAL' : 'APPROVED', assignedApproverId }, tenantId, actor, 'publish');
  }

  async createJob(dto: CreateJobDto, tenantId: string, createdByEmail?: string, activeBranchId?: string | null, actor?: AuthUser, draft = false): Promise<JobProfile> {
    validateJobDates(dto.startDate, dto.endDate);
    positiveInteger(dto.submissionRequired, 'Maximum allowed submissions');
    positiveInteger(dto.noOfPositions, 'Number of positions');
    const resolvedAccountManagerId = dto.accountManagerId
      ? await this.resolveUserUuid(dto.accountManagerId, tenantId)
      : actor?.dbId || await this.resolveUserUuid(createdByEmail, tenantId);
    let creationGrant: { id: string; expiresAt: Date | null; maxJobs: number | null; jobsUsed: number } | undefined;
    if (actor) {
      if (!resolvedAccountManagerId) throw new BadRequestException('Select a valid account manager for this job.');
      creationGrant = await this.assertCanCreateFor(actor, tenantId, resolvedAccountManagerId);
    }
    if ((dto.clientId || dto.endClientId || dto.pocId || dto.endClientPocId || dto.client || dto.endClientName) && actor && !draft) await this.resolveSelectedClients(dto, tenantId, actor, resolvedAccountManagerId);
    this.logger.log(`Creating job: ${dto.title} for tenant: ${tenantId}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, podSystemEnabled: true },
    });
    const tenantName = tenant?.name || 'enfysync Inc';

    const rawLookup = (dto as any)?.branchId || activeBranchId || dto?.businessUnit || null;
    let branchId: string | null = null;
    let branchCodeHint: string | null = null;

    if (rawLookup && rawLookup.trim().length > 0 && rawLookup !== 'null' && rawLookup !== 'undefined') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawLookup.trim());
      const bRes = await this.prisma.branch.findFirst({
        where: {
          tenantId,
          OR: [
            ...(isUuid ? [{ id: rawLookup.trim() }] : []),
            { name: { equals: rawLookup.trim(), mode: 'insensitive' } },
            { code: { equals: rawLookup.trim(), mode: 'insensitive' } },
            { name: { contains: rawLookup.trim(), mode: 'insensitive' } },
          ],
        },
        select: { id: true, code: true },
      });
      if (bRes) {
        branchId = bRes.id;
        branchCodeHint = bRes.code;
      }
    }

    if (!branchId) {
      const defaultB = await this.prisma.branch.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, code: true },
      });
      if (defaultB) {
        branchId = defaultB.id;
        branchCodeHint = defaultB.code;
      }
    }

    // Use submitted jobCode if provided and unique, otherwise auto-generate
    const businessUnitId = dto.businessUnitId || null;
    let assignmentPolicy: any = null;
    if (businessUnitId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessUnitId)) {
        throw new BadRequestException('Select a valid operating unit.');
      }
      const unit = await this.prisma.businessUnit.findFirst({ where: { id: businessUnitId, tenantId, branchId }, include: { marketSegment: { select: { code: true } } } });
      if (!unit) throw new BadRequestException('The operating unit must belong to the selected workspace and branch.');
      assignmentPolicy = { ...unit, market: unit.marketSegment?.code };
    }
    const submittedRecruiters = [...new Set([dto.recruiterId, ...(dto.recruiterIds || [])].filter((id): id is string => !!id))];
    const selectedPods = [...new Set([dto.podId, ...(dto.podIds || [])].filter((id): id is string => !!id && !['none', 'off'].includes(id)))];
    if (selectedPods.includes('all')) throw new BadRequestException('Select individual recruiters instead of a unit pool.');
    if (selectedPods.length && submittedRecruiters.length) throw new BadRequestException('Choose either pods or direct recruiters for this job.');
    const automaticPods = usesAutomaticPods(assignmentPolicy) && !submittedRecruiters.length;
    if (!draft && automaticPods) {
      if (!actor) throw new ForbiddenException('Automatic assignment requires an authenticated context.');
      await listJobPods(this.prisma, actor, tenantId, branchId || undefined, businessUnitId || undefined);
      if (selectedPods.length) {
        throw new BadRequestException('This unit chooses pods automatically. Select automatic pod assignment or direct recruiters.');
      }
    }
    if (usesAutomaticPods(assignmentPolicy) && selectedPods.length) {
      throw new BadRequestException('This unit chooses pods automatically. Select automatic pod assignment or direct recruiters.');
    }
    if (submittedRecruiters.length && !actor?.permissions?.includes('job:override_assignment')) throw new ForbiddenException('Direct recruiter assignment requires job:override_assignment.');
    if (submittedRecruiters.length && (!actor?.branchId || !actor.businessUnitId || branchId !== actor.branchId || businessUnitId !== actor.businessUnitId)) throw new ForbiddenException('Emergency assignments must stay in your current unit.');
    if (submittedRecruiters.length && (!dto.assignmentReason?.trim() || dto.assignmentReason.length > 2000)) throw new BadRequestException('Enter an emergency assignment reason (up to 2000 characters).');
    if (submittedRecruiters.length) {
      if (!actor) throw new ForbiddenException('Recruiter assignment requires an authenticated job staffing context.');
      await validateJobRecruiters(this.prisma, actor, tenantId, submittedRecruiters, branchId, businessUnitId);
      if (assignmentPolicy?.allowNone === false) throw new BadRequestException('Direct recruiter assignment is disabled for this unit.');
    }
    if (dto.podId === 'all') throw new BadRequestException('Select individual recruiters instead of a unit pool.');
    if (selectedPods.length) {
      if (!actor) throw new ForbiddenException('Pod assignment requires an authenticated context.');
      if (assignmentPolicy?.allowPods === false) throw new BadRequestException('Pod assignment is disabled for this unit.');
      const eligiblePods = await listJobPods(this.prisma, actor, tenantId, branchId || undefined, businessUnitId || undefined);
      if (selectedPods.some(id => !eligiblePods.some(p => p.id === id))) throw new ForbiddenException('The selected pod is outside the job unit.');
    }
    if (!draft && !automaticPods && assignmentPolicy?.allowUnassigned === false && !selectedPods.length && !submittedRecruiters.length) {
      throw new BadRequestException('Select a pod or at least one recruiter for this unit.');
    }
    let jobCode = dto.jobCode ? dto.jobCode.trim().toUpperCase() : '';
    if (jobCode) {
      const check = await this.prisma.job.findUnique({
        where: { jobCode },
        select: { id: true },
      });
      if (check && !draft) {
        jobCode = ''; // Code already taken, regenerate
      }
    }

    if (!jobCode) {
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        jobCode = await this.getNextJobCode(tenantId, branchId || branchCodeHint || dto.businessUnit, (dto as any)?.shift, attempts, businessUnitId || undefined);
        const check = await this.prisma.job.findUnique({
          where: { jobCode },
          select: { id: true },
        });
        if (!check) {
          isUnique = true;
        } else {
          attempts++;
        }
      }
      if (!isUnique) throw new Error('Failed to generate unique sequential job code.');
    }

    let assignedApproverId = dto.assignedApproverId || null;
    let requiresApprovalGate = false;

    if (createdByEmail && createdByEmail !== 'System') {
      // Cascading reviewer resolution: 1. User's designated reviewer -> 2. Pod Head -> 3. Branch Manager
      const creatorRows = await this.prisma.$queryRawUnsafe<any[]>(
        `          SELECT u.id, u.job_reviewer_id, u.pod_id, p.pod_head_id,
                  u.role_id,
                  (
                    SELECT COALESCE(jsonb_agg(DISTINCT p), '[]'::jsonb)
                    FROM ats.custom_roles cr2, jsonb_array_elements_text(cr2.permissions) p
                    WHERE cr2.id = u.role_id OR cr2.id = ANY(COALESCE(u.assigned_role_ids, '{}'))
                  ) as permissions
           FROM ats.users u
           LEFT JOIN ats.pods p ON p.id = u.pod_id
           WHERE (u.email = $1 OR u.id::text = $1) AND u.tenant_id = $2
           LIMIT 1`,
        createdByEmail, tenantId
      );

      const managedBranch = branchId ? await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
        select: { managers: { where: { tenantId, isActive: true }, orderBy: { id: 'asc' }, select: { id: true } } },
      }) : null;

      if (creatorRows.length > 0) {
        const cRow = creatorRows[0];
        cRow.branch_manager_id = managedBranch?.managers.find(manager => manager.id !== cRow.id)?.id || null;
        const cPerms: string[] = Array.isArray(cRow.permissions) ? cRow.permissions : [];
        const hasDirectPublish = 
          cPerms.includes('job:publish_direct') || 
          cPerms.includes('tenant:settings') || 
          cPerms.includes('tenant:manage') || 
          cPerms.includes('branch_admin:manage');

        if (cRow.job_reviewer_id) {
          assignedApproverId = cRow.job_reviewer_id;
          requiresApprovalGate = !hasDirectPublish;
        } else if (cRow.pod_head_id) {
          assignedApproverId = assignedApproverId || cRow.pod_head_id;
          requiresApprovalGate = !hasDirectPublish;
        } else if (cRow.branch_manager_id) {
          assignedApproverId = assignedApproverId || cRow.branch_manager_id;
          requiresApprovalGate = !hasDirectPublish;
        }
      }
    }

    // Auto-create client & end client if not present
    if (!draft && !dto.clientId) await this.ensureClientExists(dto.client, tenantId, createdByEmail || 'System');
    if (!draft && !dto.endClientId && dto.endClientName && dto.endClientName !== dto.client) {
      await this.ensureClientExists(dto.endClientName, tenantId, createdByEmail || 'System');
    }

    // Check if client (and end client) is in APPROVED status
    let clientApproved = true;
    if (dto.client) {
      const isClientUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.client.trim());
      const clientCheck = await this.prisma.client.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { clientName: { equals: dto.client.trim(), mode: 'insensitive' } },
            ...(isClientUuid ? [{ id: dto.client.trim() }] : []),
          ],
        },
        select: { id: true, clientName: true, status: true, approvalStatus: true },
      });
      if (clientCheck) {
        if (clientCheck.status === 'Pending Approval' || clientCheck.approvalStatus === 'PENDING_APPROVAL' || clientCheck.status === 'Rejected' || clientCheck.approvalStatus === 'REJECTED') {
          clientApproved = false;
        }
      }
    }

    if (dto.endClientName && dto.endClientName !== dto.client) {
      const isEcUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.endClientName.trim());
      const endClientCheck = await this.prisma.client.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { clientName: { equals: dto.endClientName.trim(), mode: 'insensitive' } },
            ...(isEcUuid ? [{ id: dto.endClientName.trim() }] : []),
          ],
        },
        select: { id: true, clientName: true, status: true, approvalStatus: true },
      });
      if (endClientCheck) {
        if (endClientCheck.status === 'Pending Approval' || endClientCheck.approvalStatus === 'PENDING_APPROVAL' || endClientCheck.status === 'Rejected' || endClientCheck.approvalStatus === 'REJECTED') {
          clientApproved = false;
        }
      }
    }

    // A job cannot be Active (Live) if the client is not approved
    const isApprovalRequested = this.shouldRequireJobApproval(dto, requiresApprovalGate, clientApproved, Boolean(creationGrant));
    const initialApprovalStatus = draft ? null : isApprovalRequested ? 'PENDING_APPROVAL' : (dto.approvalStatus || 'APPROVED');
    const initialJobStatus = draft ? 'Draft' : isApprovalRequested ? 'Pending Approval' : (dto.status || 'Active');

    // ── Branch Timing Snapshot ────────────────────────────────────────────────
    let jobTimezone = (dto as any)?.jobTimezone || (dto as any)?.timezone || null;
    let workStartTime = (dto as any)?.workStartTime || null;
    let workEndTime = (dto as any)?.workEndTime || null;
    let workingDays = (dto as any)?.workingDays
      ? (typeof (dto as any).workingDays === 'string' ? (dto as any).workingDays : JSON.stringify((dto as any).workingDays))
      : null;
    let shiftTiming = (dto as any)?.shiftTiming || (dto as any)?.shift || null;

    if (branchId) {
      const bRow = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { timezone: true, workStartTime: true, workEndTime: true, workingDays: true, shiftTiming: true },
      });
      if (bRow) {
        jobTimezone = jobTimezone || bRow.timezone || (dto.country === 'United States' || dto.market === 'US' ? 'America/New_York' : 'Asia/Kolkata');
        workStartTime = workStartTime || bRow.workStartTime || '09:00';
        workEndTime = workEndTime || bRow.workEndTime || '18:00';
        workingDays = workingDays || (typeof bRow.workingDays === 'string' ? bRow.workingDays : JSON.stringify(bRow.workingDays)) || '["Monday","Tuesday","Wednesday","Thursday","Friday"]';
        shiftTiming = shiftTiming || bRow.shiftTiming || `General Shift (${workStartTime} - ${workEndTime})`;
      }
    }
    if (!jobTimezone) {
      jobTimezone = dto.country === 'United States' || dto.market === 'US' ? 'America/New_York' : 'Asia/Kolkata';
    }
    if (!workStartTime) workStartTime = '09:00';
    if (!workEndTime) workEndTime = '18:00';
    if (!workingDays) workingDays = '["Monday","Tuesday","Wednesday","Thursday","Friday"]';
    if (!shiftTiming) shiftTiming = `General Shift (${workStartTime} - ${workEndTime})`;

    const resolvedPrimaryRecruiterId = submittedRecruiters[0] || null;
    const resolvedRecruitmentManagerId = await this.resolveUserUuid(dto.recruitmentManagerId, tenantId);
    const resolvedAssignedApproverId = await this.resolveUserUuid(assignedApproverId, tenantId);
    
      // Client Resolution
      let resolvedClientId: string | null = dto.clientId || null;
      let resolvedEndClientId: string | null = dto.endClientId || null;

      if (!resolvedClientId && dto.client && dto.client.trim() !== '') {
        let cName = dto.client.trim();
        const existingC = await this.prisma.client.findFirst({
          where: { clientName: { equals: cName, mode: 'insensitive' }, tenantId }
        });
        if (existingC) resolvedClientId = existingC.id;
        else if (!draft) {
          const newC = await this.prisma.client.create({ data: { clientName: cName, tenantId } });
          resolvedClientId = newC.id;
        }
      }

      if (!resolvedEndClientId && dto.endClientName && dto.endClientName.trim() !== '') {
        let ecName = dto.endClientName.trim();
        const existingEc = await this.prisma.client.findFirst({
          where: { clientName: { equals: ecName, mode: 'insensitive' }, tenantId }
        });
        if (existingEc) resolvedEndClientId = existingEc.id;
        else if (!draft) {
          const newEc = await this.prisma.client.create({ data: { clientName: ecName, tenantId } });
          resolvedEndClientId = newEc.id;
        }
      }


    try {
      const data = {
          ...(draft && dto.draftId ? { id: dto.draftId } : {}),
          tenantId,
          jobCode,
          jobTitle: dto.title,
          jobType: dto.type,
          jobDescription: dto.description,
          skillsRequired: dto.skillsRequired || [],
          secondarySkills: dto.secondarySkills || [],
          status: initialJobStatus,
          
          state: dto.state || '',
          city: dto.city || null,
          country: dto.country || null,
          clientJobId: dto.clientJobId || 'N/A',
          visaType: dto.visaType || null,
          ...commercialFields(dto, ['IN', 'IND', 'INDIA'].includes((assignmentPolicy?.market || dto.market || '').toUpperCase())),
          taxTerms: dto.taxTerms || null,
          
          
          noOfPositions: dto.noOfPositions || 1,
          submissionRequired: dto.submissionRequired ?? 1,
          submissionDone: 0,
          urgency: dto.priority || 'Medium',
          workMode: dto.workMode || (dto as any).remoteJob || 'In Office',
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          hoursPerWeek: dto.hoursPerWeek || 40,
          duration: dto.duration || '',
          accountManagerId: resolvedAccountManagerId || actor?.dbId || null,
          createdByUserId: actor?.dbId || null,
          recruitmentManagerId: resolvedRecruitmentManagerId || null,

          
          industry: dto.industry || '',
          degree: dto.degree || '',
          expMin: dto.expMin ?? 0,
          expMax: dto.expMax ?? 10,
                    respondBy: dto.respondBy ? new Date(dto.respondBy) : null,
          noticePeriod: dto.noticePeriod || '',
          market: (assignmentPolicy?.market || dto.market) === 'IN' ? 'IND' : (assignmentPolicy?.market || dto.market || 'US'),
            clientId: resolvedClientId,
            endClientId: resolvedEndClientId,
            pocId: dto.pocId || undefined,
            endClientPocId: dto.endClientPocId || undefined,
          branchId,
          businessUnitId,
            approvalStatus: initialApprovalStatus,
          assignedApproverId: resolvedAssignedApproverId || null,
          jobTimezone,
          
          
          
          shiftTiming,
          
        };
      const { createdJob, assignedPodIds } = await this.prisma.$transaction(async tx => {
        if (creationGrant) await tx.$queryRaw`SELECT id FROM ats.job_creation_grants WHERE id = ${creationGrant.id}::uuid FOR UPDATE`;
        const isExistingDraft = draft && dto.draftId ? !!await tx.job.findUnique({ where: { id: dto.draftId }, select: { id: true } }) : false;
        if (creationGrant && !isExistingDraft) {
          const quota = { id: creationGrant.id, tenantId, revokedAt: null, maxJobs: creationGrant.maxJobs,
            ...(creationGrant.expiresAt ? { expiresAt: creationGrant.expiresAt } : { expiresAt: null }),
            ...(creationGrant.maxJobs !== null ? { jobsUsed: { lt: creationGrant.maxJobs } } : {}),
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
          };
          const reserved = await tx.jobCreationGrant.updateMany({ where: quota, data: { jobsUsed: { increment: 1 } } });
          if (!reserved.count) throw new ForbiddenException('Your job creation access expired or reached its job limit.');
        }
        if (!draft && businessUnitId && !automaticPods) {
          await tx.$queryRaw`SELECT id FROM ats.business_units WHERE id = ${businessUnitId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
          const currentPolicy = await tx.businessUnit.findFirst({ where: { id: businessUnitId, tenantId, branchId } });
          if (!currentPolicy || usesAutomaticPods(currentPolicy) !== usesAutomaticPods(assignmentPolicy) || currentPolicy.allowPods !== assignmentPolicy.allowPods || currentPolicy.allowNone !== assignmentPolicy.allowNone || currentPolicy.allowUnassigned !== assignmentPolicy.allowUnassigned) {
            throw new BadRequestException('The assignment policy changed. Refresh the job form.');
          }
        }
        const automaticPodId = !draft && automaticPods
          ? await allocateAutomaticPod(tx, tenantId, branchId, businessUnitId!) : null;
        const assignedPodIds = automaticPodId ? [automaticPodId] : selectedPods;
        const createdJob = draft && dto.draftId
          ? await tx.job.upsert({ where: { id: dto.draftId }, create: data, update: {} })
          : await tx.job.create({ data });
        const jobId = createdJob.id;
        if (submittedRecruiters.length) await tx.jobRecruiter.createMany({
          data: submittedRecruiters.map(recruiterId => ({ jobId, recruiterId })), skipDuplicates: true,
        });
        if (submittedRecruiters.length) await tx.auditLog.create({ data: { tenantId, actorId: actor!.dbId, action: 'JOB_ASSIGNMENT_OVERRIDE', targetType: 'job', targetId: jobId, details: { reason: dto.assignmentReason!.trim(), recruiterIds: submittedRecruiters } } });
        for (const assignedPodId of assignedPodIds) {
          await tx.jobPod.upsert({ where: { jobId_podId: { jobId, podId: assignedPodId } }, create: { jobId, podId: assignedPodId }, update: {} });
          await tx.jobAssignmentLog.create({ data: { tenantId, jobId, podId: assignedPodId, assignedBy: createdByEmail || 'System' } });
        }
        return { createdJob, assignedPodIds };
      }, { maxWait: 10000, timeout: 15000 });
      const jobId = createdJob.id;

      if (draft) return this.findOneJob(jobId, tenantId, actor);

      // ─────────────────────────────────────────────────────────────
      // Live Real-Time Role & Reviewer Notification Dispatch
      // ─────────────────────────────────────────────────────────────
      try {
        const creatorUserId = await this.resolveUserUuid(createdByEmail, tenantId);
        const deliveryHeadIds = await this.getDeliveryHeadIds(tenantId, branchId);

        if (initialApprovalStatus === 'PENDING_APPROVAL') {
          // 1. Reviewer Gate: Notify designated reviewer/approver (if not self)
          if (resolvedAssignedApproverId && resolvedAssignedApproverId !== creatorUserId) {
            await this.notifications.create(tenantId, resolvedAssignedApproverId, {
              type: 'JOB_PENDING_APPROVAL',
              title: 'Job Requisition Pending Approval',
              message: `${createdByEmail || 'A team member'} submitted job "${jobCode} - ${dto.title}" for your review & approval.`,
              data: {
                jobId: jobId,
                jobCode: jobCode,
                jobTitle: dto.title,
                branchId: branchId,
              },
              initiatorId: createdByEmail || 'System',
            });
          }

          // 2. Also notify Delivery Head(s) of pending requisition in their branch (exclude creator and assigned approver)
          const dhNotifTargets = deliveryHeadIds.filter(id => id !== resolvedAssignedApproverId && id !== creatorUserId);
          if (dhNotifTargets.length > 0) {
            await this.notifications.createMany(tenantId, dhNotifTargets, {
              type: 'JOB_PENDING_APPROVAL',
              title: 'New Requisition Submitted for Review',
              message: `Job requisition "${jobCode} - ${dto.title}" was submitted for review in your branch by ${createdByEmail || 'AM'}.`,
              data: {
                jobId: jobId,
                jobCode: jobCode,
                jobTitle: dto.title,
                branchId: branchId,
              },
              initiatorId: createdByEmail || 'System',
            });
          }
        } else if (initialApprovalStatus === 'APPROVED') {
          // Direct Publish:
          // 1. Notify Assigned Primary Recruiter (if not self)
          if (resolvedPrimaryRecruiterId && resolvedPrimaryRecruiterId !== creatorUserId) {
            await this.notifications.create(tenantId, resolvedPrimaryRecruiterId, {
              type: 'JOB_NEW',
              title: `New Job Assigned: ${jobCode}`,
              message: `You have been assigned as primary recruiter for job "${jobCode} - ${dto.title}".`,
              data: {
                jobId: jobId,
                jobCode: jobCode,
                jobTitle: dto.title,
                branchId: branchId,
              },
              initiatorId: createdByEmail || 'System',
            });
          }

          // 2. Notify Delivery Head(s) & Reviewer (excluding creator and assigned recruiter)
          const dhTargets = new Set(
            deliveryHeadIds.filter(id => id !== resolvedPrimaryRecruiterId && id !== creatorUserId)
          );
          if (resolvedAssignedApproverId && resolvedAssignedApproverId !== resolvedPrimaryRecruiterId && resolvedAssignedApproverId !== creatorUserId) {
            dhTargets.add(resolvedAssignedApproverId);
          }
          if (dhTargets.size > 0) {
            await this.notifications.createMany(tenantId, Array.from(dhTargets), {
              type: 'JOB_NEW',
              title: `New Active Job: ${jobCode}`,
              message: `New active job requisition "${jobCode} - ${dto.title}" published for ${dto.client || 'Client'} in your branch.`,
              data: {
                jobId: jobId,
                jobCode: jobCode,
                jobTitle: dto.title,
                branchId: branchId,
              },
              initiatorId: createdByEmail || 'System',
            });
            this.logger.log(`Dispatched JOB_NEW notification to ${dhTargets.size} Delivery Head(s)/Reviewer(s)`);
          }

          // 3. Notify Pod members or branch recruiters (excluding creator, assigned recruiter, and DHs)
          const teamUserIds = new Set<string>();
          if (
            resolvedRecruitmentManagerId &&
            resolvedRecruitmentManagerId !== resolvedPrimaryRecruiterId &&
            resolvedRecruitmentManagerId !== creatorUserId &&
            !dhTargets.has(resolvedRecruitmentManagerId)
          ) {
            teamUserIds.add(resolvedRecruitmentManagerId);
          }

          if (assignedPodIds.length) {
            const podUsers = await this.prisma.user.findMany({
              where: { podId: { in: assignedPodIds }, tenantId, isActive: true },
              select: { id: true },
            });
            podUsers.forEach((r) => {
              if (r.id !== resolvedPrimaryRecruiterId && r.id !== creatorUserId && !dhTargets.has(r.id)) {
                teamUserIds.add(r.id);
              }
            });
          }

          if (teamUserIds.size > 0) {
            await this.notifications.createMany(tenantId, Array.from(teamUserIds), {
              type: 'JOB_NEW',
              title: 'New Active Job Requisition',
              message: `New active job "${jobCode} - ${dto.title}" has been published and assigned to your team.`,
              data: {
                jobId: jobId,
                jobCode: jobCode,
                jobTitle: dto.title,
                branchId: branchId,
              },
              initiatorId: createdByEmail || 'System',
            });
            this.logger.log(`Dispatched JOB_NEW broadcast notification to ${teamUserIds.size} team user(s)`);
          }
        }
      } catch (notifErr: any) {
        this.logger.warn(`Failed to dispatch job creation notification: ${notifErr.message}`);
      }

      return this.findOneJob(jobId, tenantId);
    } catch (err: any) {
      this.logger.error(`Failed to create job: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Get all jobs for a tenant with user name resolution and approval gating
   */
  async findAllJobs(tenantId: string, user?: any, activeBranchId?: string | null, filter?: string | null): Promise<JobProfile[]> {
    this.logger.log(`Fetching jobs for tenant: ${tenantId}`);

    let sql = `
      SELECT j.*,
             rm.full_name AS recruitment_manager_name,
             
             app.full_name AS assigned_approver_name,
             COALESCE(pod_info.pod_id, '') AS pod_id,
             COALESCE(pod_info.pod_name, '') AS pod_name,
               COALESCE(recruiter_info.recruiter_ids, '') AS recruiter_ids,
               COALESCE(recruiter_info.recruiter_names, '') AS multi_recruiter_names,
               COALESCE(recruiter_info.recruiter_details, '[]'::json) AS recruiter_details,
             COALESCE(cr.full_name, uc.full_name) AS creator_name,
             COALESCE(cr.email, uc.email) AS creator_email,
             uc.full_name AS account_manager_name,
             uc.email AS account_manager_email,
             b.name AS branch_name,
             b.code AS branch_code,
             cl.client_name AS mapped_client_name,
             ecl.client_name AS mapped_end_client_name,
             bu.name AS mapped_business_unit_name
      FROM ats.jobs j
      LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
      
      LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
        LEFT JOIN (
          SELECT 
            jr.job_id,
            STRING_AGG(u.id::text, ',') AS recruiter_ids,
            STRING_AGG(u.full_name, ', ') AS recruiter_names,
            JSON_AGG(JSON_BUILD_OBJECT('id', u.id::text, 'fullName', u.full_name, 'email', u.email, 'avatar', u.profile_picture) ORDER BY u.full_name) AS recruiter_details
          FROM ats.job_recruiters jr
          JOIN ats.users u ON u.id = jr.recruiter_id
          GROUP BY jr.job_id
        ) recruiter_info ON recruiter_info.job_id = j.id
      LEFT JOIN (
        SELECT 
          jp.job_id,
          STRING_AGG(p.id::text, ',') AS pod_id,
          STRING_AGG(p.name, ', ') AS pod_name
        FROM ats.job_pods jp
        JOIN ats.pods p ON p.id = jp.pod_id
        GROUP BY jp.job_id
      ) pod_info ON pod_info.job_id = j.id
      LEFT JOIN ats.users uc ON (uc.id = j.account_manager_id)
      LEFT JOIN ats.users cr ON (cr.id = j.created_by_user_id)
      LEFT JOIN ats.branches b ON b.id = j.branch_id
      LEFT JOIN ats.clients cl ON cl.id = j.client_id
      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
      WHERE j.tenant_id = $1 AND j.deleted_at IS NULL
    `;
    const params: any[] = [tenantId];
    let paramIndex = 2;

    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const managesJobs = userPermissions.some(permission => ['tenant:manage', 'tenant:settings', 'platform:manage', 'branch_admin:manage', 'unit_admin:manage', 'job:create', 'job:override_assignment'].includes(permission));
    if (!managesJobs) {
      if (!user?.dbId || !userPermissions.includes('job:view')) return [];
      sql += ` AND (
        EXISTS (SELECT 1 FROM ats.job_recruiters access_jr WHERE access_jr.job_id = j.id AND access_jr.recruiter_id = $${paramIndex}::uuid)
        OR EXISTS (SELECT 1 FROM ats.job_pods access_jp JOIN ats.pods access_p ON access_p.id = access_jp.pod_id AND access_p.tenant_id = $1
          WHERE access_jp.job_id = j.id AND (access_p.pod_head_id = $${paramIndex}::uuid OR (${userPermissions.includes('job:view_pod_jobs') || userPermissions.includes('job:submit_pod_jobs') ? 'TRUE' : 'FALSE'} AND access_p.id = (SELECT pod_id FROM ats.users WHERE id = $${paramIndex}::uuid AND tenant_id = $1))))
      )`;
      params.push(user.dbId); paramIndex++;
    }
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];

    const canViewAllBranches = 
      userPermissions.includes('job:view_all_branches') || 
      userPermissions.includes('tenant:settings') || 
      userPermissions.includes('tenant:manage') ||
      userPermissions.includes('platform:manage');

    const targetBranchId = canViewAllBranches ? activeBranchId : user?.branchId;
    if (!canViewAllBranches && !targetBranchId) return [];
    const unitScoped = managesCurrentUnit(user);
    if (unitScoped) {
      if (!user?.businessUnitId || !user?.branchId) return [];
      sql += ' AND j.business_unit_id = $' + paramIndex + ' AND j.branch_id = $' + (paramIndex + 1);
      params.push(user.businessUnitId, user.branchId);
      paramIndex += 2;
    }

    if (targetBranchId && !unitScoped) {
      if (user?.dbId) {
        sql += ` AND (
          j.branch_id = $${paramIndex} 
          OR j.branch_id IS NULL 
          OR $${paramIndex} = ANY(j.shared_branch_ids)
          OR EXISTS (
            SELECT 1 FROM ats.job_pods jp 
            WHERE jp.job_id = j.id AND (
              jp.pod_id IN (SELECT pod_id FROM ats.users WHERE id = $${paramIndex + 1}::uuid AND pod_id IS NOT NULL)
              OR jp.pod_id IN (SELECT id FROM ats.pods WHERE pod_head_id = $${paramIndex + 1}::uuid)
            )
          )
        )`;
        params.push(targetBranchId);
        params.push(user.dbId);
        paramIndex += 2;
      } else {
        sql += ` AND (j.branch_id = $${paramIndex} OR j.branch_id IS NULL OR $${paramIndex} = ANY(j.shared_branch_ids))`;
        params.push(targetBranchId);
        paramIndex++;
      }
    }

    // ── Dynamic Role-Based Job Isolation Gates ─────────────────────────────
    // 1. Administrators and Governance roles oversee all branch requisitions
    const isGlobalOrBranchAdmin = 
      userPermissions.includes('tenant:manage') || 
      userPermissions.includes('tenant:settings') || 
      userPermissions.includes('branch_admin:manage') ||
      userPermissions.includes('job:view_all') ||
      userPermissions.includes('platform:manage') ||
      userPermissions.includes('unit_admin:manage') ||
      userPermissions.includes('job:view_all_branches');

    // 2. Account Managers: MUST ONLY see jobs created/managed by themselves
    const isAccountManager = 
      !isGlobalOrBranchAdmin && (
        userRoles.includes('ACCOUNT_MANAGER') || 
        userRoles.includes('AM') ||
        userPermissions.includes('job:create')
      );

    if (isAccountManager && user?.dbId) {
      if (user.businessUnitId) {
        sql += ` AND j.business_unit_id = $${paramIndex}::uuid`;
        params.push(user.businessUnitId);
      } else {
        sql += ` AND (j.account_manager_id = $${paramIndex}::uuid OR j.recruitment_manager_id = $${paramIndex}::uuid)`;
        params.push(user.dbId);
      }
      paramIndex += 1;

    } else if (!isGlobalOrBranchAdmin && user?.dbId) {
      // 3. Recruiters: Only see approved/active jobs (unit isolation is already applied above)
      // They can see all jobs in their unit by default per user request.
      sql += ` AND (
        ((j.approval_status = 'APPROVED' OR j.approval_status IS NULL) AND UPPER(COALESCE(j.status, '')) NOT IN ('PENDING APPROVAL', 'PENDING_APPROVAL', 'DRAFT'))
        OR j.assigned_approver_id = $${paramIndex}::uuid
        OR j.created_by_user_id = $${paramIndex}::uuid
      )`;
      params.push(user.dbId);
      paramIndex++;
    }

    // ── Sub-view Filter Parameters (direct, pod, unassigned) ─────────────────
    if (filter === 'dashboard') {
      // The account-manager dashboard is intentionally narrower than the shared
      // job catalog: it only aggregates jobs owned by the authenticated user.
      if (!user?.dbId) return [];
      sql += ` AND j.account_manager_id = $${paramIndex}::uuid`;
      params.push(user.dbId);
      paramIndex++;
    } else if (filter === 'sourcing') {
      if (!user?.dbId) return [];
      sql += ` AND UPPER(j.status) = 'ACTIVE'
        AND (j.approval_status = 'APPROVED' OR j.approval_status IS NULL)
        AND (
          EXISTS (SELECT 1 FROM ats.job_recruiters jr_s WHERE jr_s.job_id = j.id AND jr_s.recruiter_id = $${paramIndex}::uuid)
          OR EXISTS (
            SELECT 1 FROM ats.job_pods jp_s
            JOIN ats.pods p_s ON p_s.id = jp_s.pod_id AND p_s.tenant_id = $1
            JOIN ats.users u_s ON u_s.pod_id = p_s.id AND u_s.tenant_id = $1
            WHERE jp_s.job_id = j.id AND u_s.id = $${paramIndex}::uuid AND u_s.is_active = true AND (${userPermissions.includes('job:view_pod_jobs') || userPermissions.includes('job:submit_pod_jobs') ? 'TRUE' : 'FALSE'} OR p_s.pod_head_id = u_s.id)
          )
        )`;
      params.push(user.dbId);
      paramIndex++;
    } else if (filter === 'my' && user?.dbId) {
      if (isAccountManager) {
        sql += ` AND (j.account_manager_id = $${paramIndex}::uuid OR j.recruitment_manager_id = $${paramIndex}::uuid)`;
      } else {
        sql += ` AND EXISTS (SELECT 1 FROM ats.job_recruiters jr_f WHERE jr_f.job_id = j.id AND jr_f.recruiter_id = $${paramIndex}::uuid)`;
      }
      params.push(user.dbId);
      paramIndex += 1;
    } else if (filter === 'direct' && user?.dbId) {
      sql += ` AND EXISTS (SELECT 1 FROM ats.job_recruiters jr_f WHERE jr_f.job_id = j.id AND jr_f.recruiter_id = $${paramIndex}::uuid)`;
      params.push(user.dbId);
      paramIndex++;
    } else if (filter === 'pod' && user?.dbId) {
      sql += ` AND EXISTS (
        SELECT 1 FROM ats.job_pods jp WHERE jp.job_id = j.id
        AND (
          jp.pod_id IN (SELECT pod_id FROM ats.users WHERE id = $${paramIndex}::uuid AND pod_id IS NOT NULL)
          OR jp.pod_id IN (SELECT id FROM ats.pods WHERE pod_head_id = $${paramIndex}::uuid)
        )
      )`;
      params.push(user.dbId);
      paramIndex++;
    } else if (filter === 'unassigned') {
        sql += ` AND (
          NOT EXISTS (SELECT 1 FROM ats.job_recruiters jr_un WHERE jr_un.job_id = j.id)
          AND NOT EXISTS (SELECT 1 FROM ats.job_pods jp2 WHERE jp2.job_id = j.id)
      )`;
    }

    sql += ' ORDER BY j.created_at DESC';

    try {
      this.logger.log(`findAllJobs SQL: ${sql} | Params: ${JSON.stringify(params)}`);
      const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);
      this.logger.log(`findAllJobs returned ${rows.length} jobs.`);
      return rows.map((row) => this.mapRowToProfile(row));
    } catch (err: any) {
      this.logger.error(`Failed to fetch jobs: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Get single job by UUID or job code
   */
  async findOneJob(idOrCode: string, tenantId: string, user?: any): Promise<JobProfile> {
    this.logger.log(`Fetching job: ${idOrCode} for tenant: ${tenantId}`);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(idOrCode);

    const sql = isUuid
      ? `SELECT j.*, rm.full_name AS recruitment_manager_name, 
                app.full_name AS assigned_approver_name,
                COALESCE(pod_info.pod_id, '') AS pod_id, COALESCE(pod_info.pod_name, '') AS pod_name,
               COALESCE(recruiter_info.recruiter_ids, '') AS recruiter_ids,
               COALESCE(recruiter_info.recruiter_names, '') AS multi_recruiter_names,
               COALESCE(recruiter_info.recruiter_details, '[]'::json) AS recruiter_details,
                COALESCE(cr.full_name, uc.full_name) AS creator_name, COALESCE(cr.email, uc.email) AS creator_email,
                uc.full_name AS account_manager_name, uc.email AS account_manager_email,
                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name
         FROM ats.jobs j
         LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
         
         LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
        LEFT JOIN (
          SELECT 
            jr.job_id,
            STRING_AGG(u.id::text, ',') AS recruiter_ids,
            STRING_AGG(u.full_name, ', ') AS recruiter_names,
            JSON_AGG(JSON_BUILD_OBJECT('id', u.id::text, 'fullName', u.full_name, 'email', u.email, 'avatar', u.profile_picture) ORDER BY u.full_name) AS recruiter_details
          FROM ats.job_recruiters jr
          JOIN ats.users u ON u.id = jr.recruiter_id
          GROUP BY jr.job_id
        ) recruiter_info ON recruiter_info.job_id = j.id
         LEFT JOIN (
           SELECT 
             jp.job_id,
             STRING_AGG(p.id::text, ',') AS pod_id,
             STRING_AGG(p.name, ', ') AS pod_name
           FROM ats.job_pods jp
           JOIN ats.pods p ON p.id = jp.pod_id
           GROUP BY jp.job_id
         ) pod_info ON pod_info.job_id = j.id
         LEFT JOIN ats.users uc ON (uc.id = j.account_manager_id)
         LEFT JOIN ats.users cr ON (cr.id = j.created_by_user_id)
         LEFT JOIN ats.clients cl ON cl.id = j.client_id
         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
         WHERE j.tenant_id = $1 AND j.id = $2::uuid AND j.deleted_at IS NULL LIMIT 1`
      : `SELECT j.*, rm.full_name AS recruitment_manager_name, 
                app.full_name AS assigned_approver_name,
                COALESCE(pod_info.pod_id, '') AS pod_id, COALESCE(pod_info.pod_name, '') AS pod_name,
               COALESCE(recruiter_info.recruiter_ids, '') AS recruiter_ids,
               COALESCE(recruiter_info.recruiter_names, '') AS multi_recruiter_names,
               COALESCE(recruiter_info.recruiter_details, '[]'::json) AS recruiter_details,
                COALESCE(cr.full_name, uc.full_name) AS creator_name, COALESCE(cr.email, uc.email) AS creator_email,
                uc.full_name AS account_manager_name, uc.email AS account_manager_email,
                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name
         FROM ats.jobs j
         LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
         
         LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
        LEFT JOIN (
          SELECT 
            jr.job_id,
            STRING_AGG(u.id::text, ',') AS recruiter_ids,
            STRING_AGG(u.full_name, ', ') AS recruiter_names,
            JSON_AGG(JSON_BUILD_OBJECT('id', u.id::text, 'fullName', u.full_name, 'email', u.email, 'avatar', u.profile_picture) ORDER BY u.full_name) AS recruiter_details
          FROM ats.job_recruiters jr
          JOIN ats.users u ON u.id = jr.recruiter_id
          GROUP BY jr.job_id
        ) recruiter_info ON recruiter_info.job_id = j.id
         LEFT JOIN (
           SELECT 
             jp.job_id,
             STRING_AGG(p.id::text, ',') AS pod_id,
             STRING_AGG(p.name, ', ') AS pod_name
           FROM ats.job_pods jp
           JOIN ats.pods p ON p.id = jp.pod_id
           GROUP BY jp.job_id
         ) pod_info ON pod_info.job_id = j.id
         LEFT JOIN ats.users uc ON (uc.id = j.account_manager_id)
         LEFT JOIN ats.users cr ON (cr.id = j.created_by_user_id)
         LEFT JOIN ats.clients cl ON cl.id = j.client_id
         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
         WHERE j.tenant_id = $1 AND j.job_code = $2 AND j.deleted_at IS NULL LIMIT 1`;

    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, tenantId, idOrCode);
      if (rows.length === 0) {
        throw new NotFoundException(`Job requisition ${idOrCode} not found.`);
      }
      assertUnitJobScope(user, { branchId: rows[0].branch_id, businessUnitId: rows[0].business_unit_id });
      if (user && !(user.permissions || []).some((permission: string) => ['tenant:manage', 'tenant:settings', 'platform:manage', 'branch_admin:manage', 'unit_admin:manage', 'job:create', 'job:override_assignment'].includes(permission))) {
        const direct = await this.prisma.jobRecruiter.findUnique({ where: { jobId_recruiterId: { jobId: rows[0].id, recruiterId: user.dbId } }, select: { jobId: true } });
        const pod = direct ? null : await this.prisma.pod.findFirst({ where: { tenantId, jobPods: { some: { jobId: rows[0].id } }, OR: [{ podHeadId: user.dbId }, ...((user.permissions || []).some((permission: string) => ['job:view_pod_jobs', 'job:submit_pod_jobs'].includes(permission)) ? [{ users: { some: { id: user.dbId, tenantId, isActive: true } } }] : [])] }, select: { id: true } });
        if (!direct && !pod) throw new ForbiddenException('This job has not been assigned to you or your lead workspace.');
      }
      if (user) { const row = rows[0]; const userPermissions = Array.isArray(user?.permissions) ? user.permissions : []; const isAdmin = userPermissions.includes('tenant:settings') || userPermissions.includes('tenant:manage') || userPermissions.includes('platform:manage') || userPermissions.includes('*'); const hasViewPerm = userPermissions.includes('job:view') || userPermissions.includes('job:edit') || userPermissions.includes('job:view_all_branches'); const isOwner = row.account_manager_id === user?.dbId || row.account_manager_id === user?.id || row.recruitment_manager_id === user?.dbId || row.recruitment_manager_id === user?.id || row.created_by_user_id === user?.dbId || row.created_by_user_id === user?.id; if (!isAdmin && !hasViewPerm && !isOwner) { throw new ForbiddenException('You do not have permission to view this job.'); } } return this.mapRowToProfile(rows[0]);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(`findOneJob failed: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Map a raw Postgres/Prisma row to the typed JobProfile response
   */
  private mapRowToProfile(row: any): JobProfile {
    const rawCreatedAt = row.created_at ?? row.createdAt;
    const createdAt = rawCreatedAt ? new Date(rawCreatedAt) : new Date();
    const agingDays = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    const rawUpdatedAt = row.updated_at ?? row.updatedAt;
    const rawStartDate = row.start_date ?? row.startDate;
    const rawEndDate = row.end_date ?? row.endDate;
    const rawRespondBy = row.respond_by ?? row.respondBy;
    const rawApprovedAt = row.approved_at ?? row.approvedAt;
    let rawRecruiterDetails = row.recruiter_details ?? row.recruiterDetails ?? [];
    if (typeof rawRecruiterDetails === 'string') {
      try {
        rawRecruiterDetails = JSON.parse(rawRecruiterDetails);
      } catch {
        rawRecruiterDetails = [];
      }
    }
    const recruiterDetails: AssignedRecruiterProfile[] = Array.isArray(rawRecruiterDetails)
      ? rawRecruiterDetails
          .filter((recruiter: any) => recruiter && recruiter.id)
          .map((recruiter: any) => ({
            id: String(recruiter.id),
            fullName: String(recruiter.fullName || recruiter.full_name || 'Recruiter'),
            email: recruiter.email || null,
            avatar: recruiter.avatar || recruiter.profilePicture || recruiter.profile_picture || null,
          }))
      : [];


    return {
      id: row.id,
      jobCode: row.job_code ?? row.jobCode,
      jobTitle: row.job_title ?? row.jobTitle,
      businessUnit: row.mapped_business_unit_name || row.business_unit_id || '',
      businessUnitId: row.business_unit_id ?? row.businessUnitId ?? null,
      client: row.mapped_client_name || row.client_id,
      clientId: row.client_id ?? row.clientId ?? null,
      endClientId: row.end_client_id ?? row.endClientId ?? null,
      endClientName: row.mapped_end_client_name || null,
      pocId: row.poc_id ?? row.pocId ?? null,
      endClientPocId: row.end_client_poc_id ?? row.endClientPocId ?? null,
      clientJobId: row.client_job_id ?? row.clientJobId ?? 'N/A',
      state: row.state || '',
      city: row.city || null,
      country: row.country || 'United States',
      type: row.job_type ?? row.jobType,
      description: row.job_description ?? row.jobDescription,
      skillsRequired: row.skills_required ?? row.skillsRequired ?? [],
      secondarySkills: row.secondary_skills ?? row.secondarySkills ?? [],
      jobStatus: row.status,
      createdOn: createdAt.toISOString(),
      modifiedOn: rawUpdatedAt
        ? new Date(rawUpdatedAt).toISOString()
        : createdAt.toISOString(),
      createdAt: createdAt.toISOString(),
      updatedAt: rawUpdatedAt ? new Date(rawUpdatedAt).toISOString() : createdAt.toISOString(),

      // Co-Sourcing mappings
      isCoSourced: row.is_co_sourced ?? false,
      sharedBranchIds: row.shared_branch_ids ?? [],
      marginSplitAmPct: row.margin_split_am_pct ?? null,
      marginSplitRecPct: row.margin_split_rec_pct ?? null,

      visaType: row.visa_type ?? row.visaType ?? '',
      clientBillRate: row.client_bill_rate ?? row.clientBillRate ?? displayCommercialRate(row, 'clientBill'),
      payRate: row.pay_rate ?? row.payRate ?? displayCommercialRate(row, 'pay'),
      taxTerms: row.tax_terms ?? row.taxTerms ?? 'C2C',

      

      noOfPositions: row.no_of_positions ?? row.noOfPositions ?? 1,
      submissionRequired: row.submission_required ?? row.submissionRequired ?? 1,
      submissionDone: row.submission_done ?? row.submissionDone ?? 0,
      priority: row.urgency || 'Medium',

      workMode: row.work_mode ?? row.workMode ?? 'In Office',
      startDate: rawStartDate ? new Date(rawStartDate).toISOString().split('T')[0] : null,
      endDate: rawEndDate ? new Date(rawEndDate).toISOString().split('T')[0] : null,
      hoursPerWeek: row.hours_per_week ?? row.hoursPerWeek ?? 40,
      duration: row.duration || '',

      accountManagerId: row.account_manager_id ?? row.accountManagerId ?? '',
      accountManagerName: row.account_manager_name ?? row.accountManagerName ?? null,
      accountManagerEmail: row.account_manager_email ?? row.accountManagerEmail ?? null,
      recruitmentManagerId: row.recruitment_manager_id ?? row.recruitmentManagerId ?? '',
      recruitmentManager: row.recruitment_manager_name ?? row.recruitmentManagerName ?? 'N/A',
              recruiter: row.multi_recruiter_names || row.recruiter_name || row.recruiterName || 'N/A',
        recruiterIds: row.recruiter_ids ? String(row.recruiter_ids).split(',').filter(Boolean) : [],
        recruiterDetails,
      createdBy: row.creator_name ?? row.creatorName ?? 'System',
      creatorEmail: row.creator_email ?? row.creatorEmail ?? null,
      createdByUserId: row.created_by_user_id ?? row.createdByUserId ?? null,

      industry: row.industry || '',
      degree: row.degree || '',
      expMin: row.exp_min ?? row.expMin ?? 0,
      expMax: row.exp_max ?? row.expMax ?? 10,

      // Computed fields
      submissionsCount: row.submission_done ?? row.submissionDone ?? 0,
      agingDays,
      pipeline: { applied: 0, interviewing: 0, offered: 0 },
      podId: row.pod_id ?? row.podId ?? '',
      podIds: String(row.pod_id ?? row.podId ?? '').split(',').filter(Boolean),
      podName: row.pod_name ?? row.podName ?? '',
      branchId: row.branch_id ?? row.branchId ?? '',
      branchName: row.branch_name ?? row.branchName ?? '',
      branchCode: row.branch_code ?? row.branchCode ?? '',
      respondBy: rawRespondBy ? new Date(rawRespondBy).toISOString().split('T')[0] : null,
      noticePeriod: row.notice_period ?? row.noticePeriod ?? '',
      market: row.market || 'US',

      // Approval Workflow
      approvalStatus: row.approval_status ?? row.approvalStatus ?? (row.status === 'Pending Approval' ? 'PENDING_APPROVAL' : 'APPROVED'),
      assignedApproverId: row.assigned_approver_id ?? row.assignedApproverId ?? null,
      assignedApproverName: row.assigned_approver_name ?? row.assignedApproverName ?? null,
      approvedBy: row.approved_by ?? row.approvedBy ?? null,
      approvedAt: rawApprovedAt ? new Date(rawApprovedAt).toISOString() : null,
      rejectionReason: row.rejection_reason ?? row.rejectionReason ?? null,

      // Branch Timing Snapshot
      jobTimezone: row.job_timezone ?? row.jobTimezone ?? (row.country === 'United States' || row.market === 'US' ? 'America/New_York' : 'Asia/Kolkata'),
      shiftTiming: row.shift_timing ?? row.shiftTiming ?? 'General Day Shift (09:00 - 18:00)',
      timingSnapshotAt: null,
    };
  }

  /**
   * Approve a pending job requisition and activate it for recruiters
   */
  async approveJob(
    jobId: string,
    tenantId: string,
    approver: any,
    overrides?: { recruiterId?: string; podId?: string }
  ): Promise<JobProfile> {
    this.logger.log(`Approving job ${jobId} by ${approver?.email || approver?.dbId}`);

    const currentJob = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!currentJob) {
      throw new NotFoundException(`Job with ID "${jobId}" not found.`);
    }

    // Verify associated client (and end client) is in APPROVED status
    if (false /* removed clientName */) {
      const isCUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test("".trim());
      const clientCheck = await this.prisma.client.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { clientName: { equals: "".trim(), mode: 'insensitive' } },
            ...(isCUuid ? [{ id: "".trim() }] : []),
          ],
        },
        select: { clientName: true, status: true, approvalStatus: true },
      });
      if (clientCheck) {
        if (clientCheck?.status === 'Pending Approval' || clientCheck?.approvalStatus === 'PENDING_APPROVAL') {
          throw new BadRequestException(`Cannot activate job requisition: Client is pending approval. The client must be approved before jobs can go live.`);
        }
        if (clientCheck?.status === 'Rejected' || clientCheck?.approvalStatus === 'REJECTED') {
          throw new BadRequestException(`Cannot activate job requisition: Client was rejected. Please reactivate or approve the client first.`);
        }
      }
    }

    if (false /* removed endClientName */ && "" !== "") {
      const isEcUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test("".trim());
      const endClientCheck = await this.prisma.client.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { clientName: { equals: "".trim(), mode: 'insensitive' } },
            ...(isEcUuid ? [{ id: "".trim() }] : []),
          ],
        },
        select: { clientName: true, status: true, approvalStatus: true },
      });
      if (endClientCheck) {
        if (endClientCheck?.status === 'Pending Approval' || endClientCheck?.approvalStatus === 'PENDING_APPROVAL') {
          throw new BadRequestException(`Cannot activate job requisition: End Client is pending approval. The client must be approved first.`);
        }
        if (endClientCheck?.status === 'Rejected' || endClientCheck?.approvalStatus === 'REJECTED') {
          throw new BadRequestException(`Cannot activate job requisition: End Client was rejected.`);
        }
      }
    }

    
    

    if (overrides?.podId) {
      await this.prisma.jobPod.upsert({
        where: { jobId_podId: { jobId, podId: overrides.podId } },
        create: { jobId, podId: overrides.podId },
        update: {},
      });
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'Active',
        approvalStatus: 'APPROVED',
        approvedBy: approver?.dbId || null,
        approvedAt: new Date(),
                
      },
    });

    // Live Notification on Approval: Notify Creator & Assigned Recruiter/Pod
    try {
      if (currentJob.accountManagerId ) {
        const creatorTarget = currentJob.accountManagerId ;
        if (creatorTarget) {
          const isTargetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creatorTarget);
          const creatorUser = await this.prisma.user.findFirst({
            where: {
              tenantId,
              OR: [
                ...(isTargetUuid ? [{ id: creatorTarget }] : []),
                { email: creatorTarget },
              ],
            },
            select: { id: true },
          });
          if (creatorUser) {
            await this.notifications.create(tenantId, creatorUser.id, {
              type: 'JOB_APPROVED',
              title: 'Job Requisition Approved',
              message: `Your job requisition "${currentJob.jobCode} - ${currentJob.jobTitle}" was approved by ${approver?.fullName || approver?.email || 'Approver'}.`,
              data: {
                jobId: jobId,
                jobCode: currentJob.jobCode,
                jobTitle: currentJob.jobTitle,
              },
              initiatorId: approver?.dbId || 'System',
            });
          }
        }
      }

      const assignedRecruiters = new Set<string>();
      
      const effectivePodId = overrides?.podId;
      if (effectivePodId) {
        const podUsers = await this.prisma.user.findMany({
          where: { podId: effectivePodId, tenantId, isActive: true },
          select: { id: true },
        });
        podUsers.forEach((r) => assignedRecruiters.add(r.id));
      }

      if (assignedRecruiters.size > 0) {
        await this.notifications.createMany(tenantId, Array.from(assignedRecruiters), {
          type: 'JOB_NEW',
          title: 'New Job Active (Approved)',
          message: `Job "${currentJob.jobCode} - ${currentJob.jobTitle}" has been approved and is now active for recruitment.`,
          data: {
            jobId: jobId,
            jobCode: currentJob.jobCode,
            jobTitle: currentJob.jobTitle,
          },
          initiatorId: approver?.dbId || 'System',
        });
      }

      const deliveryHeadIds = await this.getDeliveryHeadIds(tenantId, currentJob.branchId);
      const dhTargets = deliveryHeadIds.filter(id => !assignedRecruiters.has(id));
      if (dhTargets.length > 0) {
        await this.notifications.createMany(tenantId, dhTargets, {
          type: 'JOB_NEW',
          title: `Job Approved: ${currentJob.jobCode}`,
          message: `Job "${currentJob.jobCode} - ${currentJob.jobTitle}" was approved by ${approver?.fullName || 'Approver'} and is now active in your branch.`,
          data: {
            jobId: jobId,
            jobCode: currentJob.jobCode,
            jobTitle: currentJob.jobTitle,
            branchId: currentJob.branchId,
          },
          initiatorId: approver?.dbId || 'System',
        });
      }
    } catch (notifErr: any) {
      this.logger.warn(`Failed to dispatch job approval notification: ${notifErr.message}`);
    }

    return this.findOneJob(jobId, tenantId);
  }

  /**
   * Reject a pending job requisition with feedback reason
   */
  async rejectJob(jobId: string, tenantId: string, approver: any, reason: string): Promise<JobProfile> {
    this.logger.log(`Rejecting job ${jobId} by ${approver?.email}: ${reason}`);

    const currentJob = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!currentJob) {
      throw new NotFoundException(`Job with ID "${jobId}" not found.`);
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'Draft',
        approvalStatus: 'REJECTED',
        rejectionReason: reason || 'Job requirement rejected by reviewer.',
      },
    });

    // Live Notification on Rejection: Notify Creator with Reason
    try {
      if (currentJob.accountManagerId ) {
        const creatorTarget = currentJob.accountManagerId ;
        if (creatorTarget) {
          const isTargetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creatorTarget);
          const creatorUser = await this.prisma.user.findFirst({
            where: {
              tenantId,
              OR: [
                ...(isTargetUuid ? [{ id: creatorTarget }] : []),
                { email: creatorTarget },
              ],
            },
            select: { id: true },
          });
          if (creatorUser) {
            await this.notifications.create(tenantId, creatorUser.id, {
              type: 'JOB_REJECTED',
              title: 'Job Requisition Rejected',
              message: `Your job requisition "${currentJob.jobCode} - ${currentJob.jobTitle}" was rejected. Feedback: ${reason || 'No specific feedback provided.'}`,
              data: {
                jobId: jobId,
                jobCode: currentJob.jobCode,
                jobTitle: currentJob.jobTitle,
                rejectionReason: reason,
              },
              initiatorId: approver?.dbId || 'System',
            });
          }
        }
      }
    } catch (notifErr: any) {
      this.logger.warn(`Failed to dispatch job rejection notification: ${notifErr.message}`);
    }

    return this.findOneJob(jobId, tenantId);
  }

  /**
   * Update job details (including recruiter assignments with permissions validation)
   */
  async changeStatus(id: string, dto: { status: string; expectedStatus: string; reason?: string }, tenantId: string, user: AuthUser) {
    const permissions = user.permissions || [];
    const global = permissions.some(p => ['*', 'tenant:manage', 'tenant:settings', 'platform:manage'].includes(p));
    if (!global && !permissions.includes('job:edit')) throw new ForbiddenException('Missing job:edit permission.');
    const job = await this.prisma.job.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!job) throw new NotFoundException('Job not found.');
    assertUnitJobScope(user, job);
    if (!global && job.branchId && user.branchId !== job.branchId) throw new ForbiddenException('Job is outside your branch scope.');
    if (!global && user.businessUnitId && job.businessUnitId !== user.businessUnitId) throw new ForbiddenException('Job is outside your unit scope.');
    if (typeof dto.status !== 'string' || typeof dto.expectedStatus !== 'string') throw new BadRequestException('Status and previous status are required.');
    const status = normalizeJobStatus(dto.status);
    if (!status || status === 'Pending Approval') throw new BadRequestException('Select an operational job status.');
    if (job.approvalStatus && job.approvalStatus !== 'APPROVED') throw new BadRequestException('Use the approval workflow before changing this job status.');
    if (normalizeJobStatus(job.status) === 'Pending Approval') throw new BadRequestException('Use the approval workflow for this job.');
    if (dto.expectedStatus !== job.status) throw new BadRequestException('Job status changed. Refresh and try again.');
    if (dto.reason !== undefined && (typeof dto.reason !== 'string' || dto.reason.length > 2000)) throw new BadRequestException('Reason must be text of up to 2000 characters.');
    const reason = dto.reason?.trim();
    if (status === 'Active' && job.clientId) {
      const client = await this.prisma.client.findFirst({ where: { id: job.clientId, tenantId, deletedAt: null } });
      if (!client || ['PENDING_APPROVAL', 'REJECTED'].includes(client.approvalStatus || '') || ['pending approval', 'rejected'].includes((client.status || '').toLowerCase())) throw new BadRequestException('The client must be approved before activating this job.');
    }
    await this.prisma.$transaction(async tx => {
      const updated = await tx.job.updateMany({ where: { id, tenantId, status: job.status, updatedAt: job.updatedAt }, data: { status } });
      if (!updated.count) throw new BadRequestException('Job changed. Refresh and try again.');
      await tx.auditLog.create({ data: { tenantId, actorId: user.dbId || user.email, actorEmail: user.email, action: 'JOB_STATUS_CHANGED', targetType: 'job', targetId: id, details: { before: job.status, after: status, ...(reason ? { reason } : {}) } } });
    });
    return { status };
  }

  async updateJob(
    id: string,
    dto: any,
    tenantId: string,
    user: any,
    mode?: 'draft' | 'publish'
  ): Promise<JobProfile> {
    this.logger.log(`Updating job: ${id} for tenant: ${tenantId}`);
    positiveInteger(dto.submissionRequired, 'Maximum allowed submissions');
    positiveInteger(dto.noOfPositions, 'Number of positions');

    if (!mode && dto.status !== undefined) {
      if (typeof dto.status !== 'string') throw new BadRequestException('Invalid job status.');
      const original = await this.prisma.job.findFirst({ where: { id, tenantId, deletedAt: null } });
      if (!original) throw new NotFoundException('Job not found.');
      const statusChanged = dto.status !== original.status && (!normalizeJobStatus(dto.status) || normalizeJobStatus(dto.status) !== normalizeJobStatus(original.status));
      if (statusChanged) {
        if (!Object.keys(dto).every(key => ['status', 'reason', 'expectedStatus'].includes(key))) throw new BadRequestException('Use Change status to update job status separately from other fields.');
        await this.changeStatus(id, { status: dto.status, expectedStatus: dto.expectedStatus ?? original.status, reason: dto.reason || 'Updated through job editor' }, tenantId, user);
      }
      if (Object.keys(dto).every(key => ['status', 'reason', 'expectedStatus'].includes(key))) return this.findOneJob(id, tenantId, user);
      dto = { ...dto }; delete dto.status;
    }
    // Fetch the job first to verify existence
    const currentJob = await this.prisma.job.findFirst({
      where: { id, tenantId },
    });
    if (!currentJob) {
      throw new NotFoundException(`Job not found.`);
    }
    const assignmentChanged = dto.recruiterIds !== undefined || dto.recruiterId !== undefined || dto.podId !== undefined || dto.podIds !== undefined;
    if (assignmentChanged && user.permissions?.includes('job:override_assignment')) {
      if (!user.branchId || !user.businessUnitId || currentJob.branchId !== user.branchId || currentJob.businessUnitId !== user.businessUnitId || (dto.branchId !== undefined && dto.branchId !== user.branchId) || (dto.businessUnitId !== undefined && dto.businessUnitId !== user.businessUnitId)) throw new ForbiddenException('Emergency assignments must stay in your current unit.');
      if (typeof dto.assignmentReason !== 'string' || !dto.assignmentReason.trim() || dto.assignmentReason.length > 2000) throw new BadRequestException('Enter an emergency assignment reason (up to 2000 characters).');
    }
    assertUnitJobScope(user, currentJob);
    assertUnitJobScope(user, { branchId: dto.branchId ?? currentJob.branchId, businessUnitId: dto.businessUnitId ?? currentJob.businessUnitId });
    if (dto.startDate !== undefined || dto.endDate !== undefined) validateJobDates(
      dto.startDate !== undefined ? dto.startDate : currentJob.startDate,
      dto.endDate !== undefined ? dto.endDate : currentJob.endDate,
    );
    if (mode) await this.assertDraftAccess(currentJob, tenantId, user);
    if (!mode && (dto.clientId || dto.endClientId || dto.pocId || dto.endClientPocId)) await this.resolveSelectedClients(dto, tenantId, user);

    const publishUnitId = dto.businessUnitId ?? currentJob.businessUnitId;
    const publishBranchId = dto.branchId ?? currentJob.branchId;
    const publishPolicy = mode === 'publish' && publishUnitId
      ? await this.prisma.businessUnit.findFirst({ where: { id: publishUnitId, tenantId, branchId: publishBranchId } }) : null;
    const publishingRecruiters = dto.recruiterIds !== undefined || dto.recruiterId !== undefined
      ? (dto.recruiterIds || (dto.recruiterId ? [dto.recruiterId] : []))
      : mode === 'publish' && usesAutomaticPods(publishPolicy) ? (await this.prisma.jobRecruiter.findMany({ where: { jobId: id }, select: { recruiterId: true } })).map(mapping => mapping.recruiterId) : [];
    const automaticPublish = mode === 'publish' && usesAutomaticPods(publishPolicy) && !publishingRecruiters.length;
    if (mode === 'publish' && publishingRecruiters.length) {
      if (publishPolicy?.allowNone !== true) throw new BadRequestException('Direct recruiter assignment is disabled for this unit.');
      await validateJobRecruiters(this.prisma, user, tenantId, publishingRecruiters, publishBranchId, publishUnitId, id);
    }
    let automaticallyAssignedPodId: string | null = null;
    if (automaticPublish) {
      await listJobPods(this.prisma, user, tenantId, publishBranchId || undefined, publishUnitId || undefined, id);
      // Draft selections may belong to an older unit policy. Route under current policy.
      dto = { ...dto };
      for (const key of ['podId', 'podIds', 'recruiterId', 'recruiterIds']) delete dto[key];
    }

    if (dto.podId === 'all' || dto.podIds?.includes('all')) {
      throw new BadRequestException('Select individual recruiters instead of a unit pool.');
    }
    if (dto.podId !== undefined || dto.podIds !== undefined || dto.recruiterId !== undefined || dto.recruiterIds !== undefined || dto.businessUnitId !== undefined || dto.branchId !== undefined) {
      const unitId = dto.businessUnitId ?? currentJob.businessUnitId;
      const branchId = dto.branchId ?? currentJob.branchId;
      const policy = unitId ? await this.prisma.businessUnit.findFirst({ where: { id: unitId, tenantId, branchId } }) : null;
      if (unitId && !policy) throw new ForbiddenException('The job unit is outside this workspace.');
      const podChanged = dto.podId !== undefined || dto.podIds !== undefined;
      const scopeChanged = unitId !== currentJob.businessUnitId || branchId !== currentJob.branchId;
      const requestedPods: string[] = podChanged ? (dto.podIds || (dto.podId ? [dto.podId] : [])).filter((p: string) => !['none', 'off'].includes(p)) : [];

      const currentPods = await this.prisma.jobPod.findMany({ where: { jobId: id }, select: { podId: true } });
      const podsToValidate = automaticPublish ? [] : podChanged ? requestedPods : scopeChanged ? currentPods.map(p => p.podId) : [];
      if ((podChanged || scopeChanged) && (podsToValidate.length || (podChanged && currentPods.length))) {
        if (podsToValidate.length && policy?.allowPods === false) throw new BadRequestException('Pod assignment is disabled for this unit.');
        if (requestedPods.length && usesAutomaticPods(policy)) throw new BadRequestException('This unit chooses pods automatically. Select automatic pod assignment or direct recruiters.');
        const eligible = await listJobPods(this.prisma, user, tenantId, branchId || undefined, unitId || undefined, id);
        if (podsToValidate.some(p => !eligible.some(option => option.id === p))) throw new ForbiddenException('The selected pod is outside the job unit.');
      }
      const recruitersChanged = dto.recruiterId !== undefined || dto.recruiterIds !== undefined;
      const requestedRecruiters: string[] = recruitersChanged ? (dto.recruiterIds || (dto.recruiterId ? [dto.recruiterId] : [])) : [];
      if (scopeChanged && !recruitersChanged && !automaticPublish) {
        const mappings = await this.prisma.jobRecruiter.findMany({ where: { jobId: id }, select: { recruiterId: true } });
        requestedRecruiters.push(...mappings.map(mapping => mapping.recruiterId));
        if (requestedRecruiters.length) await validateJobRecruiters(this.prisma, user, tenantId, requestedRecruiters, branchId, unitId);
      }
      if (requestedRecruiters.length && !currentPods.length && !requestedPods.length && !user.permissions?.includes('job:override_assignment') && policy?.allowNone === false) throw new BadRequestException('Direct recruiter assignment is disabled for this unit.');
      if (mode !== 'draft' && !automaticPublish && policy?.allowUnassigned === false) {
        const hasPods = podChanged ? requestedPods.length > 0 : currentPods.length > 0;
        const hasRecruiters = recruitersChanged ? requestedRecruiters.length > 0 : await this.prisma.jobRecruiter.count({ where: { jobId: id } }) > 0;
        if (!hasPods && !hasRecruiters) throw new BadRequestException('Select a pod or at least one recruiter for this unit.');
      }
    }

    const _userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
    const _isAdmin = _userPermissions.includes('tenant:settings') || _userPermissions.includes('tenant:manage') || _userPermissions.includes('platform:manage') || _userPermissions.includes('*');
    const _hasEditPerm = _userPermissions.includes('job:edit');
    const _isOwner = currentJob.accountManagerId === user?.dbId || currentJob.accountManagerId === user?.id || 
                     currentJob.recruitmentManagerId === user?.dbId || currentJob.recruitmentManagerId === user?.id;
    const isScopedPodLead = user.permissions?.includes('job:assign_recruiter') && !user.permissions?.some((p: string) => ['job:override_assignment', 'tenant:manage', 'tenant:settings', 'platform:manage', 'branch_admin:manage'].includes(p));

    const assignmentOnlyFields = new Set(['recruiterId', 'recruiterIds', 'recruiter', 'assignedTo']);
    const isPodLeadAssignmentOnly = isScopedPodLead &&
      (dto.recruiterIds !== undefined || dto.recruiterId !== undefined) &&
      Object.keys(dto).every(key => assignmentOnlyFields.has(key));
    if (!_isAdmin && !_hasEditPerm && !_isOwner && !isPodLeadAssignmentOnly) {
      throw new ForbiddenException('You do not have permission to edit this job.');
    }

    // If attempting to set status to 'Active', ensure client is approved
    if (dto.status === 'Active') {
      const targetClient = dto.client || "";
      if (targetClient) {
        const isClientUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetClient.trim());
        const clientCheck = await this.prisma.client.findFirst({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              { clientName: { equals: targetClient.trim(), mode: 'insensitive' } },
              ...(isClientUuid ? [{ id: targetClient.trim() }] : []),
            ],
          },
          select: { clientName: true, status: true, approvalStatus: true },
        });
        if (clientCheck) {
          if (clientCheck?.status === 'Pending Approval' || clientCheck?.approvalStatus === 'PENDING_APPROVAL') {
            throw new BadRequestException(`Cannot make job Active: Client "${clientCheck.clientName}" is pending approval. The client must be approved before jobs can go live.`);
          }
          if (clientCheck?.status === 'Rejected' || clientCheck?.approvalStatus === 'REJECTED') {
            throw new BadRequestException(`Cannot make job Active: Client "${clientCheck.clientName}" is rejected.`);
          }
        }
      }
    }

    // Define Tenant Admin, Branch Admin, Unit Admin, Delivery Head, or Job Owner clearance
    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles : [];
    const isTenantAdmin = userPermissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(p));
    const isBranchAdmin = 
      userPermissions.includes('branch_admin:manage') ||
      (currentJob.branchId && user?.branchRoles?.[currentJob.branchId]?.some((r: string) => ['TENANT_ADMIN', 'BRANCH_ADMIN'].includes(r)));
    const isUnitAdmin = userPermissions.includes('unit_admin:manage');
    const isDeliveryHead = userRoles.some(r => ['DELIVERY_HEAD', 'DELIVERYHEAD'].includes(r.toUpperCase().replace(/[\s-_]+/g, ''))) ||
      userPermissions.includes('job:assign');

    const isSupervisoryAssigner = isTenantAdmin || isBranchAdmin || userPermissions.includes('job:override_assignment');
    const normalizedActorRoles = [...userRoles, user?.systemRole || ''].map(r => r.toUpperCase().replace(/[\s-_]+/g, ''));
    const isRecruiterOnly = normalizedActorRoles.includes('RECRUITER') &&
      !normalizedActorRoles.some(r => ['PODLEAD', 'PODHEAD', 'ACCOUNTMANAGER', 'BDM', 'DELIVERYHEAD', 'BRANCHADMIN', 'UNITADMIN', 'TENANTADMIN', 'SUPERADMIN'].includes(r));

    const isJobCreator = Boolean(
      (currentJob.accountManagerId && (user?.dbId === currentJob.accountManagerId || user?.id === currentJob.accountManagerId)) ||
      (currentJob.recruitmentManagerId && (user?.dbId === currentJob.recruitmentManagerId || user?.id === currentJob.recruitmentManagerId))
    );

    const isAccountManager = userRoles.some(r => ['ACCOUNT_MANAGER', 'ACCOUNTMANAGER', 'BDM'].includes(r.toUpperCase().replace(/[\s-_]+/g, ''))) ||
      (!isSupervisoryAssigner && userPermissions.includes('job:assign_recruiter'));

    // Account Managers / non-supervisory users can only assign recruiters on their own created jobs if enabled by tenant admin
    if (!isSupervisoryAssigner && !isScopedPodLead && (dto.recruiterIds !== undefined || dto.recruiterId !== undefined)) {
      if (!userPermissions.includes('job:assign_recruiter')) {
        throw new ForbiddenException('You do not have permission to assign recruiters.');
      }
      if (isAccountManager && !isJobCreator) {
        throw new ForbiddenException('Account Managers can only assign staff to their own created jobs.');
      }
    }

    const canAssignAny = isSupervisoryAssigner || isJobCreator;

    // Fetch the job's current pod mappings
    const jobPods = await this.prisma.jobPod.findMany({ where: { jobId: id }, select: { podId: true } });
    const isUnassignedJob = jobPods.length === 0;

    let podLeadPodId: string | null = null;
    if (isScopedPodLead && !isSupervisoryAssigner) {
      const pod = await this.prisma.pod.findFirst({
        where: { tenantId, podHeadId: user.dbId },
        select: { id: true },
      });
      podLeadPodId = pod?.id || null;
      if (!podLeadPodId || !jobPods.some(mapping => mapping.podId === podLeadPodId)) {
        throw new ForbiddenException('You can only assign recruiters to jobs mapped to your pod.');
      }
    }

    // If updating recruiter_id or recruiterIds, apply validation rules
    let targetRecruiterIds: string[] = [];
    if (dto.recruiterIds !== undefined) {
      targetRecruiterIds = Array.isArray(dto.recruiterIds) ? [...new Set<string>(dto.recruiterIds)] : [];
      if (targetRecruiterIds.length > 0) dto.recruiterId = targetRecruiterIds[0];
      else dto.recruiterId = null;
    } else if (dto.recruiterId !== undefined) {
      if (dto.recruiterId) targetRecruiterIds = [dto.recruiterId];
    }

    if (dto.recruiterIds !== undefined || dto.recruiterId !== undefined) {

      await validateJobRecruiters(this.prisma, user, tenantId, targetRecruiterIds,
        dto.branchId ?? currentJob.branchId, dto.businessUnitId ?? currentJob.businessUnitId, isScopedPodLead ? id : undefined);

      const newRecruiterId = dto.recruiterId;

      if (isUnassignedJob && !canAssignAny) {
        throw new BadRequestException("Unassigned jobs can only be assigned by a Tenant Admin, Branch Admin, or an authorized staff member.");
      }

      if (isScopedPodLead && !isSupervisoryAssigner) {
        if (newRecruiterId) {
          const recruiter = await this.prisma.user.findFirst({
            where: { id: newRecruiterId, tenantId, podId: podLeadPodId },
            select: { id: true },
          });
          if (!recruiter) throw new ForbiddenException('You can only assign recruiters belonging to your own pod.');
        }
      } else if (canAssignAny) {
        if (newRecruiterId) {
          const recruiter = await this.prisma.user.findFirst({
            where: { id: newRecruiterId, tenantId },
            select: { id: true },
          });
          if (!recruiter) {
            throw new NotFoundException("Selected recruiter does not exist in this tenant.");
          }
        }
      } else {
        const userWithPod = await this.prisma.user.findFirst({
          where: { id: user.dbId, tenantId },
          select: { podId: true },
        });
        const userPodId = userWithPod?.podId;
        if (!userPodId) {
          throw new BadRequestException("You are not assigned to any pod.");
        }

        const jobPodMatch = await this.prisma.jobPod.findUnique({
          where: { jobId_podId: { jobId: id, podId: userPodId } },
          select: { jobId: true },
        });
        if (!jobPodMatch) {
          throw new BadRequestException("You can only assign recruiters to jobs mapped to your pod.");
        }

        if (newRecruiterId) {
          const recruiter = await this.prisma.user.findFirst({
            where: { id: newRecruiterId, tenantId },
            select: { podId: true },
          });
          if (!recruiter || recruiter.podId !== userPodId) {
            throw new BadRequestException("You can only assign recruiters belonging to your own pod.");
          }
        }
      }
    }

    // Auto-create client & end client if not present
    const creatorId = user?.dbId || 'System';
    if (!mode && !dto.clientId && dto.client !== undefined) {
      await this.ensureClientExists(dto.client, tenantId, creatorId);
    }
    if (!mode && !dto.endClientId && dto.endClientName !== undefined) {
      await this.ensureClientExists(dto.endClientName, tenantId, creatorId);
    }

    const dataToUpdate: any = {};
    if (mode && dto.branchId !== undefined) dataToUpdate.branchId = dto.branchId;
    if (mode && dto.businessUnitId !== undefined) dataToUpdate.businessUnitId = dto.businessUnitId;
    if (dto.title !== undefined) dataToUpdate.jobTitle = dto.title;
    if (dto.type !== undefined) dataToUpdate.jobType = dto.type;
    if (dto.description !== undefined) dataToUpdate.jobDescription = dto.description;
    if (dto.skillsRequired !== undefined) dataToUpdate.skillsRequired = dto.skillsRequired;
    if (dto.secondarySkills !== undefined) dataToUpdate.secondarySkills = dto.secondarySkills;
    if (dto.status !== undefined) dataToUpdate.status = dto.status;
    
    if (dto.state !== undefined) dataToUpdate.state = dto.state;
    if (dto.city !== undefined) dataToUpdate.city = dto.city;
    if (dto.country !== undefined) dataToUpdate.country = dto.country;
    if (dto.clientJobId !== undefined) dataToUpdate.clientJobId = dto.clientJobId;
    if (dto.pocId !== undefined) dataToUpdate.pocId = dto.pocId;
    if (dto.endClientPocId !== undefined) dataToUpdate.endClientPocId = dto.endClientPocId;
    if (dto.visaType !== undefined) dataToUpdate.visaType = dto.visaType;
    Object.assign(dataToUpdate, commercialFields(dto, ['IN', 'IND', 'INDIA'].includes((currentJob.market || '').toUpperCase())));
    if (dto.clientId !== undefined || mode === 'draft') dataToUpdate.clientId = dto.clientId || null;
    if (dto.endClientId !== undefined || mode === 'draft') dataToUpdate.endClientId = dto.endClientId || null;
    if (mode === 'publish') {
      dataToUpdate.approvalStatus = dto.approvalStatus;
      dataToUpdate.assignedApproverId = dto.assignedApproverId;
    }
    if (dto.taxTerms !== undefined) dataToUpdate.taxTerms = dto.taxTerms;
    
    
    if (dto.noOfPositions !== undefined) dataToUpdate.noOfPositions = dto.noOfPositions;
    if (dto.submissionRequired !== undefined) dataToUpdate.submissionRequired = dto.submissionRequired;
    if (dto.priority !== undefined) dataToUpdate.urgency = dto.priority;
    if (dto.remoteJob !== undefined) dataToUpdate.workMode = dto.remoteJob;
    if (dto.startDate !== undefined) dataToUpdate.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) dataToUpdate.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.hoursPerWeek !== undefined) dataToUpdate.hoursPerWeek = dto.hoursPerWeek;
    if (dto.duration !== undefined) dataToUpdate.duration = dto.duration;
    if (!mode && dto.accountManagerId !== undefined) dataToUpdate.accountManagerId = await this.resolveUserUuid(dto.accountManagerId, tenantId);
    if (dto.recruitmentManagerId !== undefined) dataToUpdate.recruitmentManagerId = dto.recruitmentManagerId;

    
    if (dto.industry !== undefined) dataToUpdate.industry = dto.industry;
    if (dto.degree !== undefined) dataToUpdate.degree = dto.degree;
    if (dto.expMin !== undefined) dataToUpdate.expMin = dto.expMin;
    if (dto.expMax !== undefined) dataToUpdate.expMax = dto.expMax;
    if (dto.respondBy !== undefined) dataToUpdate.respondBy = dto.respondBy ? new Date(dto.respondBy) : null;
    if (dto.noticePeriod !== undefined) dataToUpdate.noticePeriod = dto.noticePeriod;
    if (dto.jobTimezone !== undefined) dataToUpdate.jobTimezone = dto.jobTimezone;
    
    
    
    if (dto.shiftTiming !== undefined) dataToUpdate.shiftTiming = dto.shiftTiming;

    if (automaticPublish) {
      automaticallyAssignedPodId = await this.prisma.$transaction(async tx => {
        const podId = await allocateAutomaticPod(tx, tenantId, publishBranchId, publishUnitId!);
        const updated = await tx.job.updateMany({ where: { id, tenantId, status: 'Draft', updatedAt: currentJob.updatedAt }, data: dataToUpdate });
        if (!updated.count) throw new BadRequestException('The draft changed. Refresh and try again.');
        await tx.jobPod.deleteMany({ where: { jobId: id } });
        await tx.jobRecruiter.deleteMany({ where: { jobId: id } });
        if (podId) {
          await tx.jobPod.create({ data: { jobId: id, podId } });
          await tx.jobAssignmentLog.create({ data: { tenantId, jobId: id, podId, assignedBy: user.email || 'System' } });
        }
        return podId;
      }, { maxWait: 10000, timeout: 15000 });
    } else if (Object.keys(dataToUpdate).length > 0 && mode) {
      const updated = await this.prisma.job.updateMany({
        where: { id, tenantId, status: 'Draft', updatedAt: currentJob.updatedAt },
        data: dataToUpdate,
      });
      if (!updated.count) throw new BadRequestException('The draft changed. Refresh and try again.');
    } else if (Object.keys(dataToUpdate).length > 0) {
      await this.prisma.job.update({
        where: { id },
        data: dataToUpdate,
      });
    }

    if (dto.recruiterIds !== undefined || dto.recruiterId !== undefined) {
      await this.prisma.$transaction(async tx => {
        await tx.jobRecruiter.deleteMany({ where: { jobId: id, ...(podLeadPodId ? { recruiter: { tenantId, podId: podLeadPodId } } : {}) } });
        if (targetRecruiterIds.length > 0) await tx.jobRecruiter.createMany({ data: targetRecruiterIds.map(recruiterId => ({ jobId: id, recruiterId })) });
        if (user.permissions?.includes('job:override_assignment')) await tx.auditLog.create({ data: { tenantId, actorId: user.dbId, action: 'JOB_ASSIGNMENT_OVERRIDE', targetType: 'job', targetId: id, details: { reason: dto.assignmentReason.trim(), recruiterIds: targetRecruiterIds, podIds: dto.podIds || [] } } });
      });
    }


    // If updating pod assignment (e.g. for Admins/Branch Admins/Authorized Users re-routing jobs)
    if (dto.podId !== undefined || dto.podIds !== undefined) {
      if (!canAssignAny) {
        throw new ForbiddenException('You do not have permission to modify job pod assignments.');
      }

      await this.prisma.jobPod.deleteMany({ where: { jobId: id } });
      if (dto.podId === 'all') {
        
      } else if (dto.podId === 'none' || dto.podId === 'off') {
        if (false) {
          
        }
      } else {
        const podIdsToAssign: string[] = [];
        if (Array.isArray(dto.podIds) && dto.podIds.length > 0) {
          podIdsToAssign.push(...dto.podIds.filter((p: string) => p && p !== 'none' && p !== 'off'));
        } else if (dto.podId && dto.podId !== 'none' && dto.podId !== 'off') {
          podIdsToAssign.push(dto.podId);
        }

        if (podIdsToAssign.length > 0) {
          if (false) {
            
          }
          for (const pId of podIdsToAssign) {
            await this.prisma.jobPod.upsert({
              where: { jobId_podId: { jobId: id, podId: pId } },
              create: { jobId: id, podId: pId },
              update: {},
            });
            await this.prisma.jobAssignmentLog.create({
              data: {
                tenantId,
                jobId: id,
                podId: pId,
                assignedBy: user?.email || 'System',
              },
            });
          }
        }
      }
    }

    // Dispatch live notification if primary recruiter was assigned or changed
    if ((dto.podId !== undefined || dto.podIds !== undefined) && user.permissions?.includes('job:override_assignment') && dto.recruiterId === undefined && dto.recruiterIds === undefined) {
      await this.prisma.auditLog.create({ data: { tenantId, actorId: user.dbId, action: 'JOB_ASSIGNMENT_OVERRIDE', targetType: 'job', targetId: id, details: { reason: dto.assignmentReason.trim(), podIds: dto.podIds || (dto.podId ? [dto.podId] : []) } } });
    }
    try {
      if (automaticallyAssignedPodId && dto.status !== 'Pending Approval') {
        const members = await this.prisma.user.findMany({ where: { tenantId, podId: automaticallyAssignedPodId, isActive: true, isApproved: true }, select: { id: true } });
        if (members.length) await this.notifications.createMany(tenantId, members.map(member => member.id), {
          type: 'JOB_NEW', title: `Job Assigned: ${currentJob.jobCode}`,
          message: `Your pod has been assigned job "${currentJob.jobCode} - ${dto.title || currentJob.jobTitle}".`,
          data: { jobId: id, jobCode: currentJob.jobCode, branchId: publishBranchId }, initiatorId: user.dbId,
        });
      }
      if (mode === 'publish' && dto.status === 'Pending Approval' && dto.assignedApproverId && dto.assignedApproverId !== user.dbId) {
        await this.notifications.create(tenantId, dto.assignedApproverId, {
          type: 'JOB_PENDING_APPROVAL', title: 'Job Requisition Pending Approval',
          message: `Job requisition "${currentJob.jobCode} - ${dto.title}" was submitted for review.`,
          data: { jobId: id, jobCode: currentJob.jobCode, branchId: currentJob.branchId }, initiatorId: user.dbId,
        });
      }
      if (mode !== 'draft' && dto.status !== 'Pending Approval' && dto.recruiterId !== undefined && dto.recruiterId) {
        const resolvedRecruiterId = await this.resolveUserUuid(dto.recruiterId, tenantId);
        if (resolvedRecruiterId) {
          await this.notifications.create(tenantId, resolvedRecruiterId, {
            type: 'JOB_NEW',
            title: `Job Assigned: ${currentJob.jobCode}`,
            message: `You have been assigned as primary recruiter for job "${currentJob.jobCode} - ${currentJob.jobTitle}".`,
            data: {
              jobId: id,
              jobCode: currentJob.jobCode,
              jobTitle: currentJob.jobTitle,
              branchId: currentJob.branchId,
            },
            initiatorId: user?.dbId || user?.email || 'System',
          });

          // Also notify Delivery Head(s)
          const deliveryHeadIds = await this.getDeliveryHeadIds(tenantId, currentJob.branchId);
          const dhTargets = deliveryHeadIds.filter(dhId => dhId !== resolvedRecruiterId);
          if (dhTargets.length > 0) {
            await this.notifications.createMany(tenantId, dhTargets, {
              type: 'JOB_NEW',
              title: `Recruiter Assigned: ${currentJob.jobCode}`,
              message: `Recruiter was assigned to job "${currentJob.jobCode} - ${currentJob.jobTitle}" in your branch.`,
              data: {
                jobId: id,
                jobCode: currentJob.jobCode,
                jobTitle: currentJob.jobTitle,
                branchId: currentJob.branchId,
              },
              initiatorId: user?.dbId || user?.email || 'System',
            });
          }
        }
      }
    } catch (notifErr: any) {
      this.logger.warn(`Failed to dispatch job update notification: ${notifErr.message}`);
    }

    return this.findOneJob(id, tenantId);
  }

  // ─────────────────────────────────────────────────────────────
  //  AI CANDIDATE MATCHING
  // ─────────────────────────────────────────────────────────────

  async findMatchingCandidates(
    jobIdOrCode: string,
    tenantId: string,
    opts: { limit?: number; minScore?: number } = {},
  ): Promise<{ job: JobProfile; matches: CandidateMatch[]; parserOnline: boolean }> {
    const job = await this.findOneJob(jobIdOrCode, tenantId);
    const limit = Math.min(opts.limit ?? 25, 100);
    const minScore = opts.minScore ?? 0;

    const primarySkills = (job.skillsRequired || []).filter(Boolean);
    const secondarySkills = (job.secondarySkills || []).filter(Boolean);
    const dictionary = await loadAssessmentSkills(this.prisma);
    const resolver = skillResolver(dictionary);
    const allSkills = [...new Set([...primarySkills, ...secondarySkills, ...[...primarySkills, ...secondarySkills].flatMap(resolver.terms)])];

    // Review and ranking use the same tenant-scoped evidence assessment.
    const parserOnline = false; // Semantic search does not yet enforce tenant isolation.
    const semanticEmails: string[] = [];

    // 2. Pull the tenant's candidate pool using indexed pre-filtering to scale to 100,000+ candidates
    let filterSql = `
      FROM ats.candidates c
      LEFT JOIN ats.resumes r ON c.resume_record_id = r.id
      WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
    `;
    const queryParams: any[] = [tenantId];
    let paramIndex = 2;
    const orConditions: string[] = [];

    if (semanticEmails.length > 0) {
      orConditions.push(`c.email = ANY($${paramIndex})`);
      queryParams.push(semanticEmails);
      paramIndex++;
    }

    if (allSkills.length > 0) {
      orConditions.push(`c.skills && $${paramIndex}::text[]`);
      queryParams.push(allSkills);
      paramIndex++;
      orConditions.push(`r.parsed_json::jsonb->'skills' ?| $${paramIndex}`);
      queryParams.push(allSkills);
      paramIndex++;

      // Also add designation & raw_text ILIKE search for resilient skill matching
      for (const skill of allSkills.slice(0, 5)) {
        if (skill && skill.length > 2) {
          orConditions.push(`c.raw_current_designation ILIKE $${paramIndex}`);
          queryParams.push(`%${skill}%`);
          paramIndex++;
          orConditions.push(`r.raw_text ILIKE $${paramIndex}`);
          queryParams.push(`%${skill}%`);
          paramIndex++;
        }
      }
    }

    if (orConditions.length > 0) {
      filterSql += ` AND (${orConditions.join(' OR ')})`;
    }

    const candRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.full_name, c.email, c.phone, c.raw_current_location,
              c.raw_current_designation, c.source, c.work_authorization,
              c.total_experience_years, c.skills, c.current_ctc, c.expected_ctc,
              c.notice_period_days, c.serving_notice, c.last_working_day, 
              c.preferred_locations, r.raw_text, r.parsed_json
       ${filterSql}`,
      ...queryParams,
    );

    const matches: CandidateMatch[] = candRows.map((row: any) => {
      const assessment = assessCandidate(job, {
        skills: row.skills, rawText: row.raw_text, parsedJson: row.parsed_json,
        totalExperienceYears: row.total_experience_years, rawCurrentLocation: row.raw_current_location,
        preferredLocations: row.preferred_locations, noticePeriodDays: row.notice_period_days,
      }, dictionary);
      const matchedPrimary = assessment.criteria.filter(item => item.category === 'primary' && item.finding === 'EVIDENCE_FOUND').map(item => item.requirement);
      const missingPrimary = assessment.criteria.filter(item => item.category === 'primary' && item.finding !== 'EVIDENCE_FOUND').map(item => item.requirement);
      const matchedSecondary = assessment.criteria.filter(item => item.category === 'secondary' && item.finding === 'EVIDENCE_FOUND');
      const years = row.total_experience_years == null ? null : Number(row.total_experience_years);
      const expScore = assessment.breakdown.find(item => item.label === 'Experience')?.score ?? null;
      const semantic = null;
      const matchScore = assessment.score ?? 0;
      const matchTier: CandidateMatch['matchTier'] =
        matchScore >= 75 ? 'Strong' : matchScore >= 50 ? 'Good' : matchScore >= 25 ? 'Fair' : 'Low';

      return {
        candidateId: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        location: row.raw_current_location || '',
        currentTitle: row.raw_current_designation || 'Unknown',
        source: row.source || 'Direct Upload',
        workAuthorization: row.work_authorization || 'Unknown',
        experienceYears: years ?? 0,
        assessment,
        matchScore,
        matchTier,
        matchedSkills: matchedPrimary,
        missingSkills: missingPrimary,
        currentCTC: row.current_ctc ? Number(row.current_ctc) : null,
        expectedCTC: row.expected_ctc ? Number(row.expected_ctc) : null,
        noticePeriodDays: row.notice_period_days ? Number(row.notice_period_days) : 0,
        servingNotice: !!row.serving_notice,
        lastWorkingDay: row.last_working_day || null,
        preferredLocations: row.preferred_locations || [],
        breakdown: {
          primarySkills: `${matchedPrimary.length}/${primarySkills.length}`,
          secondarySkills: `${matchedSecondary.length}/${secondarySkills.length}`,
          experienceFit: expScore,
          semantic: semantic !== null && semantic !== undefined ? Math.round(semantic * 100) : null,
        },
      };
    });

    const ranked = matches
      .filter((m) => m.matchScore >= minScore)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    this.logger.log(
      `Matched ${ranked.length}/${candRows.length} candidates for job ${job.jobCode} (parser ${parserOnline ? 'online' : 'offline'}).`,
    );
    return { job, matches: ranked, parserOnline };
  }

  private dbSkillsCache: { name: string; aliases: string[] }[] = [];
  private lastSkillsCacheTime = 0;

  private async getDbSkillDictionary(): Promise<{ name: string; aliases: string[] }[]> {
    const NOW = Date.now();
    if (this.dbSkillsCache.length > 0 && NOW - this.lastSkillsCacheTime < 300000) {
      return this.dbSkillsCache;
    }
    try {
      const skills = await this.prisma.skillMaster.findMany({
        include: { aliases: true },
      });
      if (skills.length > 0) {
        this.dbSkillsCache = skills.map((sm) => ({
          name: sm.canonicalName,
          aliases: sm.aliases.map((a) => a.aliasName),
        }));
        this.lastSkillsCacheTime = NOW;
        this.logger.log(`Loaded ${this.dbSkillsCache.length} canonical skills from PostgreSQL database dictionary.`);
      }
    } catch (err: any) {
      this.logger.warn(`Could not load skills_master from DB: ${err.message}`);
    }
    return this.dbSkillsCache;
  }

  async parseJobDescription(text: string): Promise<any> {
    let fastApiResult: any = null;
    const hosts = ['http://api:8000', 'http://localhost:8000'];
    for (const host of hosts) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const url = `${host}/api/v1/parse-jd`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          fastApiResult = await res.json();
          break;
        }
      } catch (err: any) {
        this.logger.debug(`Parser endpoint note at ${host}: ${err.message}`);
      }
    }

    const dbDict = await this.getDbSkillDictionary();
    const fallback = this.fallbackParseJd(text, dbDict);

    if (fastApiResult && fastApiResult.success) {
      const junkSkills = new Set(['tech', 'ci', 'cd', 'with', 'using', 'experience', 'strong', 'knowledge', 'level', 'mode', 'type']);
      const cleanFastApiPrimary = (fastApiResult.primarySkills || [])
        .filter((s: string) => s && !junkSkills.has(s.trim().toLowerCase()) && s.trim().length > 1);
      const cleanFastApiSecondary = (fastApiResult.secondarySkills || [])
        .filter((s: string) => s && !junkSkills.has(s.trim().toLowerCase()) && s.trim().length > 1);

      const mergedPrimary = Array.from(new Set([...fallback.primarySkills, ...cleanFastApiPrimary]));
      const mergedSecondary = Array.from(new Set([...fallback.secondarySkills, ...cleanFastApiSecondary]))
        .filter((s: string) => !mergedPrimary.includes(s));

      return {
        ...fastApiResult,
        jobTitle: (fastApiResult.jobTitle && fastApiResult.jobTitle !== 'Unknown') ? fastApiResult.jobTitle : fallback.jobTitle,
        experienceMin: fastApiResult.experienceMin ?? fallback.experienceMin,
        experienceMax: fastApiResult.experienceMax ?? fallback.experienceMax,
        payRate: fastApiResult.payRate || fastApiResult.ctc || fastApiResult.salary || fallback.payRate,
        ctc: fastApiResult.payRate || fastApiResult.ctc || fastApiResult.salary || fallback.payRate,
        primarySkills: mergedPrimary,
        secondarySkills: mergedSecondary,
      };
    }

    return fallback;
  }

  private fallbackParseJd(text: string, dbDict?: { name: string; aliases: string[] }[]): any {
    const rawText = text || '';
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    // 1. Extract Job Title from explicit labels or top lines
    let jobTitle = '';
    let foundExplicitTitle = false;
    for (const line of lines) {
      const cleanHeading = line.replace(/^[#\*\-\s]+/, '').trim();
      const match = cleanHeading.match(/^(?:role|job title|position|title)\s*:\s*(.+)/i);
      if (match && match[1].trim()) {
        jobTitle = match[1].replace(/[\*\#]/g, '').trim();
        foundExplicitTitle = true;
        break;
      }
    }
    if (!foundExplicitTitle) {
      for (const line of lines.slice(0, 5)) {
        const cleanLine = line.replace(/^[#\*\-\s]+/, '').replace(/\s*\([\d–—\-]+\s*years?(\s*experience)?\)/gi, '').trim();
        if (cleanLine.toLowerCase().startsWith('job summary') || cleanLine.toLowerCase().startsWith('location:')) continue;
        const roleKeywords = ['developer', 'engineer', 'architect', 'manager', 'consultant', 'administrator', 'specialist', 'analyst', 'lead', 'designer', 'tester'];
        if (cleanLine.split(/\s+/).length < 8 && roleKeywords.some((kw) => cleanLine.toLowerCase().includes(kw))) {
          jobTitle = cleanLine.replace(/[\*\#]/g, '').trim();
          break;
        }
      }
    }

    // 2. Extract Experience Min / Max
    let experienceMin = 0;
    let experienceMax = 0;
    const rangeMatch = rawText.match(/(\d+)\s*[\–\—\-to\s]+\s*(\d+)\s*(?:years?|yrs?)/i) ||
                       rawText.match(/experience\s*[:\-\s]*(\d+)\s*[\–\—\-to\s]+\s*(\d+)/i) ||
                       rawText.match(/(\d+)\s*[\–\—\-]\s*(\d+)/);
    if (rangeMatch) {
      experienceMin = parseInt(rangeMatch[1], 10);
      experienceMax = parseInt(rangeMatch[2], 10);
    } else {
      const plusMatch = rawText.match(/(\d+)\s*\+\s*(?:years?|yrs?)/i) || rawText.match(/(\d+)\+\s*years?/i);
      if (plusMatch) {
        experienceMin = parseInt(plusMatch[1], 10);
        experienceMax = experienceMin + 5;
      }
    }

    // 3. Extract Location & Remote Mode
    let country = '';
    let remoteJob = 'No';
    if (/remote/i.test(rawText)) remoteJob = 'Yes';
    if (/hybrid/i.test(rawText)) remoteJob = 'Hybrid';
    if (/united states|\busa?\b/i.test(rawText)) country = 'United States';
    if (/india/i.test(rawText)) country = 'India';

    // 4. Extract CTC / Pay Rate / Budget Range
    let payRate = '';
    let payRateMin = '';
    let payRateMax = '';

    const budgetMatch =
      rawText.match(/(?:budget|ctc|salary|pay|rate|package)\s*[:\-\s]*[₹\$]?\s*([\d\.]+)\s*(?:[\–\—\-to\s]+[₹\$]?\s*([\d\.]+))?\s*(?:lpa|lacs|lakhs|k|hr|hourly|per annum)?/i) ||
      rawText.match(/(?:₹|rs\.?|inr|\$)\s*([\d\.]+)\s*(?:[\–\—\-to\s]+(?:₹|rs\.?|inr|\$)?\s*([\d\.]+))?\s*(?:lpa|lacs|lakhs|hr|hourly)?/i) ||
      rawText.match(/([\d\.]+)\s*[\–\—\-to]\s*([\d\.]+)\s*(?:lpa|lacs|lakhs|lpa\s*ctc)/i);

    if (budgetMatch) {
      if (budgetMatch[2]) {
        payRateMin = budgetMatch[1].trim();
        payRateMax = budgetMatch[2].trim();
        payRate = `${payRateMin}-${payRateMax}`;
      } else {
        payRateMax = budgetMatch[1].trim();
        payRate = payRateMax;
      }
    }

    // 5. Intelligent Tech Stack Skill Extraction Engine
    const TECH_SKILL_DICTIONARY: { name: string; aliases: string[] }[] = (dbDict && dbDict.length > 0) ? dbDict : [
      { name: 'Java', aliases: ['Java 8', 'Java 11', 'Java 17', 'Java 21', 'Java 17+'] },
      { name: 'Python', aliases: ['Python 3', 'Python3'] },
      { name: 'TypeScript', aliases: ['TS'] },
      { name: 'JavaScript', aliases: ['JS', 'ES6'] },
      { name: 'C#', aliases: ['C-Sharp', 'CSharp'] },
      { name: '.NET', aliases: ['.NET Core', 'ASP.NET', 'ASP.NET Core'] },
      { name: 'C++', aliases: ['CPP'] },
      { name: 'Golang', aliases: ['Go'] },
      { name: 'Rust', aliases: [] },
      { name: 'PHP', aliases: [] },
      { name: 'Ruby', aliases: ['Ruby on Rails', 'Rails'] },
      { name: 'Scala', aliases: [] },
      { name: 'Kotlin', aliases: [] },
      { name: 'Swift', aliases: [] },
      { name: 'SQL', aliases: ['PL/SQL', 'T-SQL'] },
      { name: 'Spring Boot', aliases: ['SpringBoot'] },
      { name: 'Spring MVC', aliases: ['SpringMVC'] },
      { name: 'Spring Security', aliases: [] },
      { name: 'Spring Data JPA', aliases: ['Spring Data'] },
      { name: 'Microservices', aliases: ['Microservice', 'Microservices Architecture'] },
      { name: 'RESTful APIs', aliases: ['REST API', 'REST APIs', 'REST'] },
      { name: 'SOAP', aliases: ['SOAP Web Services'] },
      { name: 'GraphQL', aliases: [] },
      { name: 'gRPC', aliases: [] },
      { name: 'Hibernate', aliases: ['JPA', 'ORM'] },
      { name: 'Maven', aliases: [] },
      { name: 'Gradle', aliases: [] },
      { name: 'JUnit', aliases: [] },
      { name: 'Mockito', aliases: [] },
      { name: 'React', aliases: ['React.js', 'ReactJS'] },
      { name: 'Angular', aliases: ['AngularJS', 'Angular 2+'] },
      { name: 'Vue.js', aliases: ['Vue', 'VueJS'] },
      { name: 'Next.js', aliases: ['NextJS'] },
      { name: 'Redux', aliases: [] },
      { name: 'HTML5', aliases: ['HTML'] },
      { name: 'CSS3', aliases: ['CSS'] },
      { name: 'Tailwind CSS', aliases: ['Tailwind'] },
      { name: 'Bootstrap', aliases: [] },
      { name: 'PostgreSQL', aliases: ['Postgres'] },
      { name: 'MySQL', aliases: [] },
      { name: 'Oracle', aliases: ['Oracle DB'] },
      { name: 'SQL Server', aliases: ['MSSQL'] },
      { name: 'MongoDB', aliases: ['Mongo'] },
      { name: 'Cassandra', aliases: [] },
      { name: 'Redis', aliases: [] },
      { name: 'DynamoDB', aliases: [] },
      { name: 'Elasticsearch', aliases: ['Elastic Search'] },
      { name: 'Docker', aliases: [] },
      { name: 'Kubernetes', aliases: ['K8s'] },
      { name: 'AWS', aliases: ['Amazon Web Services'] },
      { name: 'Azure', aliases: ['Microsoft Azure'] },
      { name: 'GCP', aliases: ['Google Cloud Platform', 'Google Cloud'] },
      { name: 'CI/CD', aliases: ['CI CD', 'CI/CD Pipelines', 'CI/CD tools'] },
      { name: 'Jenkins', aliases: [] },
      { name: 'GitHub Actions', aliases: [] },
      { name: 'GitLab CI', aliases: [] },
      { name: 'Terraform', aliases: [] },
      { name: 'Ansible', aliases: [] },
      { name: 'Git', aliases: ['GitHub', 'GitLab', 'Bitbucket'] },
      { name: 'Kafka', aliases: ['Apache Kafka'] },
      { name: 'RabbitMQ', aliases: [] },
      { name: 'ActiveMQ', aliases: [] },
      { name: 'SQS', aliases: ['AWS SQS'] },
      { name: 'SOLID', aliases: ['SOLID Principles'] },
      { name: 'Design Patterns', aliases: ['Design Pattern'] },
      { name: 'OOP', aliases: ['Object Oriented Programming'] },
      { name: 'Agile', aliases: ['Scrum', 'Agile/Scrum'] },
      { name: 'System Design', aliases: [] },
      { name: 'Apex', aliases: [] },
      { name: 'LWC', aliases: ['Lightning Web Components'] },
      { name: 'SOQL', aliases: [] },
      { name: 'Salesforce', aliases: ['Sales Cloud', 'Service Cloud'] },
    ];

    let requiredSectionText = '';
    let preferredSectionText = '';
    let generalText = rawText;

    const reqMatch = rawText.match(/(?:Required\s*Skills|Key\s*Responsibilities|Qualifications|Requirements|Must\s*Have)([\s\S]*?)(?:Preferred\s*Skills|Nice\s*to\s*Have|Good\s*to\s*Have|Education|Work\s*Mode|$)/i);
    if (reqMatch) {
      requiredSectionText = reqMatch[1];
    }

    const prefMatch = rawText.match(/(?:Preferred\s*Skills|Nice\s*to\s*Have|Good\s*to\s*Have|Desired\s*Qualifications)([\s\S]*?)(?:Education|Work\s*Mode|Employment\s*Type|$)/i);
    if (prefMatch) {
      preferredSectionText = prefMatch[1];
    }

    const matchedPrimary: string[] = [];
    const matchedSecondary: string[] = [];

    TECH_SKILL_DICTIONARY.forEach((skillObj) => {
      const patterns = [skillObj.name, ...skillObj.aliases];
      const regexStr = patterns.map(p => `\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).join('|');
      const reg = new RegExp(regexStr, 'i');

      if (preferredSectionText && reg.test(preferredSectionText)) {
        if (!matchedSecondary.includes(skillObj.name)) {
          matchedSecondary.push(skillObj.name);
        }
      } else if (requiredSectionText && reg.test(requiredSectionText)) {
        if (!matchedPrimary.includes(skillObj.name)) {
          matchedPrimary.push(skillObj.name);
        }
      } else if (reg.test(generalText)) {
        if (!matchedPrimary.includes(skillObj.name) && !matchedSecondary.includes(skillObj.name)) {
          if (matchedPrimary.length < 10) {
            matchedPrimary.push(skillObj.name);
          } else {
            matchedSecondary.push(skillObj.name);
          }
        }
      }
    });

    return {
      success: true,
      jobTitle,
      experienceMin: experienceMin || 5,
      experienceMax: experienceMax || 10,
      payRate,
      payRateMin,
      payRateMax,
      budgetMin: payRateMin,
      budgetMax: payRateMax,
      ctc: payRate,
      primarySkills: matchedPrimary,
      secondarySkills: matchedSecondary,
      location: { country, state: '', city: '' },
      remoteJob,
      jobType: '',
      workAuthorization: '',
      noticePeriod: '',
    };
  }

  private async ensureClientExists(clientName: string, tenantId: string, createdBy: string): Promise<void> {
    if (!clientName) return;
    const normalized = clientName.trim();
    if (!normalized) return;

    try {
      const existing = await this.prisma.client.findFirst({
        where: {
          tenantId,
          clientName: { equals: normalized, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (!existing) {
        this.logger.log(`Auto-creating client "${normalized}" for tenant ${tenantId}`);

        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { prefixCode: true, name: true },
        });

        let prefix = tenant?.prefixCode;
        if (!prefix) {
          const rawName = tenant?.name || '';
          const cleanName = rawName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          if (cleanName.length >= 2) {
            prefix = cleanName.substring(0, 4);
          } else {
            prefix = 'CL';
          }
        }

        const counter = await this.prisma.tenantCounters.upsert({
          where: {
            tenantId_entityType: {
              tenantId,
              entityType: 'client',
            },
          },
          create: {
            tenantId,
            entityType: 'client',
            currentValue: 1,
          },
          update: {
            currentValue: { increment: 1 },
          },
          select: { currentValue: true },
        });

        const seqNumber = counter.currentValue;
        const paddedSeq = String(seqNumber).padStart(3, '0');
        const clientCode = `${prefix}-CL-${paddedSeq}`;

        let initialStatus = 'Active';
        let approvalStatus = 'APPROVED';
        let approvedBy: string | null = 'System';
        let approvedAt: Date | null = new Date();

        if (createdBy && createdBy !== 'System') {
          const creatorRows = await this.prisma.$queryRawUnsafe<any[]>(
              `SELECT u.id, u.role_id,
                      (
                        SELECT COALESCE(jsonb_agg(DISTINCT p), '[]'::jsonb)
                        FROM ats.custom_roles cr2, jsonb_array_elements_text(cr2.permissions) p
                        WHERE cr2.id = u.role_id OR cr2.id = ANY(COALESCE(u.assigned_role_ids, '{}'))
                      ) as permissions
               FROM ats.users u
               WHERE (u.email = $1 OR u.id::text = $1) AND u.tenant_id = $2
               LIMIT 1`,
            createdBy, tenantId
          ).catch(() => []);

          if (creatorRows.length > 0) {
            const cRow = creatorRows[0];
            const perms: string[] = Array.isArray(cRow.permissions) ? cRow.permissions : [];
            const hasDirectAdd = 
              perms.includes('client:direct_add') || 
              perms.includes('client:approve') || 
              perms.includes('tenant:settings') || 
              perms.includes('tenant:manage');

            if (!hasDirectAdd) {
              initialStatus = 'Pending Approval';
              approvalStatus = 'PENDING_APPROVAL';
              approvedBy = null;
              approvedAt = null;
            }
          }
        }

        await this.prisma.client.create({
          data: {
            tenantId,
            clientCode,
            clientName: normalized,
            status: initialStatus,
            approvalStatus,
            primaryOwner: createdBy,
            
            createdBy,
            modifiedBy: createdBy,
            approvedBy,
            approvedAt,
          },
        });
      }
    } catch (err: any) {
      this.logger.error(`Failed to auto-create client/end client "${clientName}": ${err.message}`, err.stack);
    }
  }

  /**
   * Duplicate / Copy an existing job requisition with a fresh sequential jobCode
   */
  async duplicateJob(id: string, tenantId: string, user: any): Promise<JobProfile> {
    this.logger.log(`Duplicating Job ID=${id} for tenant=${tenantId}`);

    const original = await this.findOneJob(id, tenantId);
    if (!original) {
      throw new NotFoundException(`Job with ID ${id} not found.`);
    }

    const branchId = (original as any).branchId || original.businessUnit;
    const newJobCode = await this.getNextJobCode(tenantId, branchId, (original as any).shift || 'DAY');

    const duplicateDto: CreateJobDto = {
      jobCode: newJobCode,
      title: `${original.jobTitle} (Copy)`,
      
      client: original.client,
      state: original.state,
      city: original.city || undefined,
      country: original.country,
      type: original.type || 'Full Time',
      description: original.description,
      skillsRequired: original.skillsRequired || [],
      secondarySkills: original.secondarySkills || [],
      status: original.jobStatus || 'Active',
      visaType: original.visaType,
      clientBillRate: original.clientBillRate,
      payRate: original.payRate,
      taxTerms: original.taxTerms,
      noOfPositions: original.noOfPositions || 1,
      submissionRequired: original.submissionRequired ?? 1,
      priority: original.priority || 'Medium',
      workMode: (original as any).workMode || (original as any).remoteJob || 'In Office',
      duration: original.duration || '',
      hoursPerWeek: original.hoursPerWeek || 40,
      industry: original.industry || '',
      degree: original.degree || '',
      expMin: (original as any).expMin ?? (original as any).experienceMin ?? 0,
      expMax: (original as any).expMax ?? (original as any).experienceMax ?? 10,
      market: (original as any).market || 'IND',
    };

    return this.createJob(duplicateDto, tenantId, user?.dbId || user?.email, branchId, user);
  }

  async deleteJob(id: string, tenantId: string): Promise<boolean> {
    this.logger.log(`Soft deleting job ${id} for tenant ${tenantId}`);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const existing = await this.prisma.job.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        ...(isUuid ? { id } : { jobCode: id }),
      },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Job ${id} not found or already deleted.`);
    }
    await this.prisma.job.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  async restoreJob(id: string, tenantId: string): Promise<JobProfile> {
    this.logger.log(`Restoring job ${id} for tenant ${tenantId}`);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const existing = await this.prisma.job.findFirst({
      where: {
        tenantId,
        deletedAt: { not: null },
        ...(isUuid ? { id } : { jobCode: id }),
      },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Job ${id} not found or not deleted.`);
    }
    await this.prisma.job.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });
    return this.findOneJob(existing.id, tenantId);
  }

  // --- Cross-Branch Delegation Logic ---

  async delegateJob(jobId: string, dto: DelegateJobDto, tenantId: string, sourceBranchId?: string, user?: any) {
    if (!sourceBranchId) throw new BadRequestException('User must belong to a branch to delegate jobs');
    const targets = await delegationTargets(this.prisma, user, jobId, tenantId);
    const target = targets.find(unit => unit.id === dto.targetUnitId);
    if (!target || !target.branchId) throw new BadRequestException('Select an eligible operating unit in the same market segment.');
    if (dto.targetBranchId && dto.targetBranchId !== target.branchId) throw new BadRequestException('Selected unit does not belong to the selected branch.');
    const targetBranchId = target.branchId;
    if (sourceBranchId === targetBranchId) throw new BadRequestException('Cannot delegate to the same branch');

    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, branchId: sourceBranchId },
    });

    if (!job) throw new NotFoundException('Job not found or does not belong to your branch');

    // Check if pending request already exists
    const existingReq = await this.prisma.jobDelegationRequest.findFirst({
      where: { tenantId, jobId, targetUnitId: target.id, status: 'PENDING' },
    });
    if (existingReq) throw new BadRequestException('A pending delegation request already exists for this branch');

    const req = await this.prisma.jobDelegationRequest.create({
      data: {
        tenantId,
        jobId,
        sourceBranchId,
        targetBranchId,
        targetUnitId: target.id,
        slaDaysTarget: dto.slaDaysTarget,
        notes: dto.notes,
        status: 'PENDING',
      },
    });

    // Notify target branch
    await this.notifications.broadcastAnnouncement(tenantId, 'System', {
      title: 'New Job Delegation Request',
      message: `Branch requested delegation for job ${job.jobCode} - ${job.jobTitle}.`,
      target: 'BRANCH',
      targetId: targetBranchId,
    });

    return req;
  }

  async getDelegationRequests(tenantId: string, branchId?: string, type: 'incoming' | 'outgoing' | 'all' = 'all', user?: any) {
    if (!branchId) throw new BadRequestException('User must belong to a branch');
    
    const whereClause: any = { tenantId };
    if (type === 'incoming') {
      whereClause.targetBranchId = branchId;
    } else if (type === 'outgoing') {
      whereClause.sourceBranchId = branchId;
    } else {
      whereClause.OR = [
        { targetBranchId: branchId },
        { sourceBranchId: branchId },
      ];
    }

    const requests = await this.prisma.jobDelegationRequest.findMany({
      where: whereClause,
      include: { 
        job: {
          include: {
            clientRef: { select: { clientName: true } },
            endClientRef: { select: { clientName: true } }
          }
        },
        sourceBranch: { select: { id: true, name: true } },
        targetBranch: { select: { id: true, name: true } },
        sourceUnit: { select: { id: true, name: true } },
        assignedPod: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [...new Set(requests.map(r => r.job?.accountManagerId).filter(Boolean))] as string[];
    let usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true, email: true }
      });
      usersMap = users.reduce((acc: any, u: any) => { acc[u.id] = u; return acc; }, {});
    }

    return requests.map(req => {
      if (req.job) {
        (req.job as any).client = (req.job as any).clientRef?.clientName || null;
        (req.job as any).endClient = (req.job as any).endClientRef?.clientName || null;
        const am = req.job.accountManagerId ? usersMap[req.job.accountManagerId] : null;
        (req.job as any).createdBy = am?.fullName || am?.email || null;
        (req.job as any).accountManagerName = am?.fullName || am?.email || null;
      }
      return req;
    });
  }

  async acceptDelegation(requestId: string, dto: AcceptDelegationDto, tenantId: string, targetBranchId?: string, user?: any) {
    if (!targetBranchId) throw new BadRequestException('User must belong to a branch');

    const req = await this.prisma.jobDelegationRequest.findFirst({
      where: { id: requestId, tenantId, targetBranchId, status: 'PENDING' },
      include: { job: true },
    });
    if (!req) throw new NotFoundException('Delegation request not found or not pending');

    await this.prisma.$transaction(async (tx) => {
      // 1. Update request status
      await tx.jobDelegationRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED', assignedPodId: dto.assignedPodId },
      });

      // 2. Update job
      const sharedIds = new Set(req.job.sharedBranchIds || []);
      sharedIds.add(targetBranchId);

      await tx.job.update({
        where: { id: req.jobId },
        data: {
          isCoSourced: true,
          sharedBranchIds: Array.from(sharedIds),
        },
      });

      // 3. Assign to Pod if selected
      if (dto.assignedPodId) {
        await tx.jobPod.upsert({
          where: { jobId_podId: { jobId: req.jobId, podId: dto.assignedPodId } },
          create: { jobId: req.jobId, podId: dto.assignedPodId },
          update: {},
        });
      }
    });

    // Notify source branch
    await this.notifications.broadcastAnnouncement(tenantId, 'System', {
      title: 'Job Delegation Accepted',
      message: `Your delegation request for job ${req.job.jobCode} was accepted by ${user?.fullName || user?.email || 'an admin'}.`,
      target: 'BRANCH',
      targetId: req.sourceBranchId,
    });

    return { success: true };
  }

  async rejectDelegation(requestId: string, dto: RejectDelegationDto, tenantId: string, targetBranchId?: string, user?: any) {
    if (!targetBranchId) throw new BadRequestException('User must belong to a branch');

    const req = await this.prisma.jobDelegationRequest.findFirst({
      where: { id: requestId, tenantId, targetBranchId, status: 'PENDING' },
      include: { job: true },
    });
    if (!req) throw new NotFoundException('Delegation request not found or not pending');

    await this.prisma.jobDelegationRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', notes: dto.notes },
    });

    // Notify source branch
    await this.notifications.broadcastAnnouncement(tenantId, 'System', {
      title: 'Job Delegation Rejected',
      message: `Your delegation request for job ${req.job.jobCode} was rejected by ${user?.fullName || user?.email || 'an admin'}.`,
      target: 'BRANCH',
      targetId: req.sourceBranchId,
    });

    return { success: true };
  }
}
