import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto } from './dtos/create-job.dto';
import { DelegateJobDto, AcceptDelegationDto, RejectDelegationDto } from './dtos/delegate-job.dto';
import { NotificationsService } from '../notifications/notifications.service';

export interface JobProfile {
  id: string;
  jobCode: string;
  jobTitle: string;
  businessUnit: string;
  businessUnitId?: string | null;
  client: string;
  clientJobId: string;
  location: string;
  state: string;
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
  remoteJob: string;
  startDate: string | null;
  endDate: string | null;
  hoursPerWeek: number;
  duration: string;

  // People
  accountManagerId: string;
  recruitmentManagerId: string;
  recruitmentManager: string;
  recruiterId: string;
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

/** A single candidate ranked against a job requisition. */
export interface CandidateMatch {
  candidateId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  source: string;
  workAuthorization: string;
  experienceYears: number;
  /** 0-100 overall fit. */
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
    experienceFit: number;   // 0-100
    semantic: number | null; // 0-100 or null if parser offline
  };
}

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.ensureJobsTableV2();
  }

  /**
   * Expanded jobs table with all Ceipal-matching columns + branch timing snapshot
   */
  private async ensureJobsTableV2() {
    try {
      await this.prisma.$executeRawUnsafe(`
        ALTER TABLE ats.jobs
          ADD COLUMN IF NOT EXISTS business_unit VARCHAR(255) DEFAULT 'enfysync Inc',
          ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT '',
          ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'United States',
          ADD COLUMN IF NOT EXISTS client_job_id VARCHAR(100) DEFAULT 'N/A',
          ADD COLUMN IF NOT EXISTS recruitment_manager_id UUID,
          ADD COLUMN IF NOT EXISTS recruiter_id UUID,
          ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255) DEFAULT 'N/A',
          ADD COLUMN IF NOT EXISTS tax_terms VARCHAR(50) DEFAULT 'C2C',
          ADD COLUMN IF NOT EXISTS remote_job VARCHAR(20) DEFAULT 'No',
          ADD COLUMN IF NOT EXISTS start_date DATE,
          ADD COLUMN IF NOT EXISTS end_date DATE,
          ADD COLUMN IF NOT EXISTS hours_per_week INT DEFAULT 40,
          ADD COLUMN IF NOT EXISTS duration VARCHAR(100) DEFAULT '',
          ADD COLUMN IF NOT EXISTS secondary_skills TEXT[] DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS industry VARCHAR(100) DEFAULT '',
          ADD COLUMN IF NOT EXISTS degree VARCHAR(100) DEFAULT '',
          ADD COLUMN IF NOT EXISTS exp_min INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS exp_max INT DEFAULT 10,
          
          ALTER COLUMN visa_type TYPE VARCHAR(500),
          ADD COLUMN IF NOT EXISTS respond_by DATE,
          ADD COLUMN IF NOT EXISTS notice_period VARCHAR(100) DEFAULT '',
          ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'APPROVED',
          ADD COLUMN IF NOT EXISTS assigned_approver_id UUID,
          ADD COLUMN IF NOT EXISTS assigned_approver_role VARCHAR(50),
          ADD COLUMN IF NOT EXISTS approved_by UUID,
          ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
          ADD COLUMN IF NOT EXISTS job_timezone VARCHAR(100),
          ADD COLUMN IF NOT EXISTS work_start_time VARCHAR(20),
          ADD COLUMN IF NOT EXISTS work_end_time VARCHAR(20),
          ADD COLUMN IF NOT EXISTS working_days TEXT,
          ADD COLUMN IF NOT EXISTS shift_timing VARCHAR(100),
          ADD COLUMN IF NOT EXISTS timing_snapshot_at TIMESTAMP WITH TIME ZONE;
      `);
    } catch (err: any) {
      this.logger.debug(`Jobs schema update note: ${err.message}`);
    }

    // Auto-heal existing jobs created under Hydrabad Branch that have GEN- prefix
    try {
      await this.prisma.$executeRawUnsafe(`
        UPDATE ats.jobs
        SET job_code = REPLACE(job_code, 'GEN-', 'HYD-')
        WHERE job_code LIKE 'GEN-%' 
          AND (business_unit ILIKE '%hydrabad%' OR business_unit ILIKE '%hyderabad%')
      `);
    } catch (e: any) {
      this.logger.warn(`Auto-heal GEN job codes failed: ${e.message}`);
    }

    this.logger.log('Jobs table V2 schema verified (all Ceipal fields + approval workflow present).');
  }

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
  async createJob(dto: CreateJobDto, tenantId: string, createdByEmail?: string, activeBranchId?: string | null): Promise<JobProfile> {
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
    let jobCode = dto.jobCode ? dto.jobCode.trim().toUpperCase() : '';
    if (jobCode) {
      const check = await this.prisma.job.findUnique({
        where: { jobCode },
        select: { id: true },
      });
      if (check) {
        jobCode = ''; // Code already taken, regenerate
      }
    }

    if (!jobCode) {
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        jobCode = await this.getNextJobCode(tenantId, branchId || branchCodeHint || dto.businessUnit, (dto as any)?.shift, attempts);
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
        `          SELECT u.id, u.job_reviewer_id, u.pod_id, p.pod_head_id, b.manager_id as branch_manager_id,
                  u.role_id,
                  (
                    SELECT COALESCE(jsonb_agg(DISTINCT p), '[]'::jsonb)
                    FROM ats.custom_roles cr2, jsonb_array_elements_text(cr2.permissions) p
                    WHERE cr2.id = u.role_id OR cr2.id = ANY(COALESCE(u.assigned_role_ids, '{}'))
                  ) as permissions
           FROM ats.users u
           LEFT JOIN ats.pods p ON p.id = u.pod_id
           LEFT JOIN ats.branches b ON b.id = u.branch_id
           WHERE (u.email = $1 OR u.id::text = $1) AND u.tenant_id = $2
           LIMIT 1`,
        createdByEmail, tenantId
      ).catch(() => []);

      if (creatorRows.length > 0) {
        const cRow = creatorRows[0];
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
    await this.ensureClientExists(dto.client, tenantId, createdByEmail || 'System');
    if (dto.endClientName && dto.endClientName !== dto.client) {
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
    const isApprovalRequested = (dto.approvalStatus === 'PENDING_APPROVAL' || dto.status === 'Pending Approval') || requiresApprovalGate || !clientApproved;
    const initialApprovalStatus = isApprovalRequested ? 'PENDING_APPROVAL' : (dto.approvalStatus || 'APPROVED');
    const initialJobStatus = isApprovalRequested ? 'Pending Approval' : (dto.status || 'Active');

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

    const resolvedPrimaryRecruiterId = await this.resolveUserUuid(dto.recruiterId, tenantId);
    const resolvedRecruitmentManagerId = await this.resolveUserUuid(dto.recruitmentManagerId, tenantId);
    const resolvedAssignedApproverId = await this.resolveUserUuid(assignedApproverId, tenantId);
    const resolvedAccountManagerId = await this.resolveUserUuid(dto.accountManagerId || ((createdByEmail && createdByEmail !== 'System') ? createdByEmail : null), tenantId);

    try {
      const createdJob = await this.prisma.job.create({
        data: {
          tenantId,
          jobCode,
          jobTitle: dto.title,
          jobLocation: dto.location,
          jobType: dto.type,
          jobDescription: dto.description,
          skillsRequired: dto.skillsRequired || [],
          secondarySkills: dto.secondarySkills || [],
          status: initialJobStatus,
          
          state: dto.state || '',
          country: dto.country || 'United States',
          clientJobId: dto.clientJobId || 'N/A',
          visaType: dto.visaType || 'US Citizen / GC',
          clientBillRate: dto.clientBillRate || 'N/A',
          payRate: dto.payRate || 'N/A',
          taxTerms: dto.taxTerms || 'C2C',
          
          
          noOfPositions: dto.noOfPositions || 1,
          submissionRequired: dto.submissionRequired || 5,
          submissionDone: 0,
          urgency: dto.priority || 'Medium',
          remoteJob: dto.remoteJob || 'No',
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          hoursPerWeek: dto.hoursPerWeek || 40,
          duration: dto.duration || '',
          accountManagerId: resolvedAccountManagerId || null,
          recruitmentManagerId: resolvedRecruitmentManagerId || null,
          recruiterId: resolvedPrimaryRecruiterId || null,
          
          industry: dto.industry || '',
          degree: dto.degree || '',
          expMin: dto.expMin ?? 0,
          expMax: dto.expMax ?? 10,
                    respondBy: dto.respondBy ? new Date(dto.respondBy) : null,
          noticePeriod: dto.noticePeriod || '',
          market: dto.market || 'US',
          branchId,
          approvalStatus: initialApprovalStatus,
          assignedApproverId: resolvedAssignedApproverId || null,
          jobTimezone,
          
          
          
          shiftTiming,
          
        },
      });
      const jobId = createdJob.id;

      // Fetch branch-level assignment settings if branchId is present
      let branchSettings: any = null;
      if (branchId) {
        branchSettings = await this.prisma.branch.findFirst({
          where: { id: branchId, tenantId },
          select: { allowNone: true, allowPods: true, allowAll: true, allowUnassigned: true, podDistributionStrategy: true },
        });
      }

      const podSystemEnabled = tenant?.podSystemEnabled !== false;
      const allowPods = branchSettings ? branchSettings.allowPods !== false && !branchSettings.allowNone : podSystemEnabled;
      const allowAll = branchSettings ? branchSettings.allowAll !== false && !branchSettings.allowNone : true;

      // Assign Pod (Explicit, Round-Robin, All Recruiters, or None)
      let assignedPodId: string | null = null;
      if (dto.podId === 'all' || (!dto.podId && !allowPods && allowAll)) {
        await this.prisma.job.update({
          where: { id: jobId },
          data: { /* removed assignedTo */ },
        });
      } else if (dto.podId && dto.podId !== 'none' && dto.podId !== 'off') {
        assignedPodId = dto.podId;
      } else if (dto.podId === 'none' || dto.podId === 'off' || (branchSettings && branchSettings.allowNone)) {
        await this.prisma.jobPod.deleteMany({ where: { jobId } });
      } else if (allowPods && podSystemEnabled) {
        let availablePod = await this.prisma.pod.findFirst({
          where: { tenantId, isAvailableForAssignment: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!availablePod) {
          await this.prisma.pod.updateMany({
            where: { tenantId },
            data: { isAvailableForAssignment: true },
          });
          availablePod = await this.prisma.pod.findFirst({
            where: { tenantId, isAvailableForAssignment: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
        }
        if (availablePod) {
          assignedPodId = availablePod.id;
          await this.prisma.pod.update({
            where: { id: assignedPodId },
            data: { isAvailableForAssignment: false },
          });
        }
      }

      if (assignedPodId) {
        await this.prisma.jobPod.upsert({
          where: { jobId_podId: { jobId, podId: assignedPodId } },
          create: { jobId, podId: assignedPodId },
          update: {},
        });
        await this.prisma.jobAssignmentLog.create({
          data: {
            tenantId,
            jobId,
            podId: assignedPodId,
            assignedBy: createdByEmail || 'System',
          },
        });
      }

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

          if (assignedPodId) {
            const podUsers = await this.prisma.user.findMany({
              where: { podId: assignedPodId, tenantId, isActive: true },
              select: { id: true },
            });
            podUsers.forEach((r) => {
              if (r.id !== resolvedPrimaryRecruiterId && r.id !== creatorUserId && !dhTargets.has(r.id)) {
                teamUserIds.add(r.id);
              }
            });
          } else if (dto.podId === 'all' || (!dto.podId && !allowPods && allowAll)) {
            if (branchId) {
              const branchUsers = await this.prisma.user.findMany({
                where: {
                  tenantId,
                  isActive: true,
                  branchId,
                },
                select: { id: true },
              });
              branchUsers.forEach((r) => {
                if (r.id !== resolvedPrimaryRecruiterId && r.id !== creatorUserId && !dhTargets.has(r.id)) {
                  teamUserIds.add(r.id);
                }
              });
            }
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
             pr.full_name AS recruiter_name,
             app.full_name AS assigned_approver_name,
             COALESCE(pod_info.pod_id, '') AS pod_id,
             COALESCE(pod_info.pod_name, '') AS pod_name,
             uc.full_name AS creator_name,
             uc.email AS creator_email,
             b.name AS branch_name,
             b.code AS branch_code,
             cl.client_name AS mapped_client_name,
             ecl.client_name AS mapped_end_client_name,
             bu.name AS mapped_business_unit_name
      FROM ats.jobs j
      LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
      LEFT JOIN ats.users pr ON pr.id = j.recruiter_id
      LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
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
      LEFT JOIN ats.branches b ON b.id = j.branch_id
      LEFT JOIN ats.clients cl ON cl.id = j.client_id
      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
      WHERE j.tenant_id = $1 AND j.deleted_at IS NULL
    `;
    const params: any[] = [tenantId];
    let paramIndex = 2;

    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];

    const canViewAllBranches = 
      userPermissions.includes('job:view_all_branches') || 
      userPermissions.includes('tenant:settings') || 
      userPermissions.includes('tenant:manage') ||
      userPermissions.includes('platform:manage');

    const targetBranchId = canViewAllBranches ? activeBranchId : user?.branchId;
    if (!canViewAllBranches && !targetBranchId) return [];
    const unitScoped = userPermissions.includes('unit_admin:manage') && !userPermissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage', 'branch_admin:manage', 'job:view_all_branches'].includes(p));
    if (unitScoped) {
      if (!user?.businessUnitId) return [];
      sql += ' AND j.business_unit_id = $' + paramIndex;
      params.push(user.businessUnitId);
      paramIndex++;
    }

    if (targetBranchId) {
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
      )`;
      params.push(user.dbId);
      paramIndex++;
    }

    // ── Sub-view Filter Parameters (direct, pod, unassigned) ─────────────────
    if (filter === 'my' && user?.dbId) {
      if (isAccountManager) {
        sql += ` AND (j.account_manager_id = $${paramIndex}::uuid OR j.recruitment_manager_id = $${paramIndex}::uuid)`;
      } else {
        sql += ` AND j.recruiter_id = $${paramIndex}::uuid`;
      }
      params.push(user.dbId);
      paramIndex += 1;
    } else if (filter === 'direct' && user?.dbId) {
      sql += ` AND j.recruiter_id = $${paramIndex}::uuid`;
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
        j.recruiter_id IS NULL 
        AND NOT EXISTS (SELECT 1 FROM ats.job_pods jp2 WHERE jp2.job_id = j.id)
        AND (
          j.assigned_to IS NULL 
          OR TRIM(j.assigned_to) = '' 
          OR UPPER(TRIM(j.assigned_to)) IN ('UNASSIGNED', 'NONE', 'N/A')
        )
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
  async findOneJob(idOrCode: string, tenantId: string): Promise<JobProfile> {
    this.logger.log(`Fetching job: ${idOrCode} for tenant: ${tenantId}`);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(idOrCode);

    const sql = isUuid
      ? `SELECT j.*, rm.full_name AS recruitment_manager_name, pr.full_name AS recruiter_name,
                app.full_name AS assigned_approver_name,
                COALESCE(pod_info.pod_id, '') AS pod_id, COALESCE(pod_info.pod_name, '') AS pod_name,
                uc.full_name AS creator_name, uc.email AS creator_email,
                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name
         FROM ats.jobs j
         LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
         LEFT JOIN ats.users pr ON pr.id = j.recruiter_id
         LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
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
         LEFT JOIN ats.clients cl ON cl.id = j.client_id
         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
         WHERE j.tenant_id = $1 AND j.id = $2::uuid AND j.deleted_at IS NULL LIMIT 1`
      : `SELECT j.*, rm.full_name AS recruitment_manager_name, pr.full_name AS recruiter_name,
                app.full_name AS assigned_approver_name,
                COALESCE(pod_info.pod_id, '') AS pod_id, COALESCE(pod_info.pod_name, '') AS pod_name,
                uc.full_name AS creator_name, uc.email AS creator_email,
                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name
         FROM ats.jobs j
         LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
         LEFT JOIN ats.users pr ON pr.id = j.recruiter_id
         LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
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
         LEFT JOIN ats.clients cl ON cl.id = j.client_id
         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
         WHERE j.tenant_id = $1 AND j.job_code = $2 AND j.deleted_at IS NULL LIMIT 1`;

    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(sql, tenantId, idOrCode);
      if (rows.length === 0) {
        throw new NotFoundException(`Job requisition ${idOrCode} not found.`);
      }
      return this.mapRowToProfile(rows[0]);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
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
    const rawTimingSnapshotAt = row.timing_snapshot_at ?? row.timingSnapshotAt;

    return {
      id: row.id,
      jobCode: row.job_code ?? row.jobCode,
      jobTitle: row.job_title ?? row.jobTitle,
      businessUnit: row.mapped_business_unit_name || row.business_unit_id || '',
      businessUnitId: row.business_unit_id ?? row.businessUnitId ?? null,
      client: row.mapped_client_name || row.client_id,
      clientJobId: row.client_job_id ?? row.clientJobId ?? 'N/A',
      location: row.job_location ?? row.jobLocation,
      state: row.state || '',
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
      clientBillRate: row.client_bill_rate ?? row.clientBillRate ?? 'N/A',
      payRate: row.pay_rate ?? row.payRate ?? 'N/A',
      taxTerms: row.tax_terms ?? row.taxTerms ?? 'C2C',

      

      noOfPositions: row.no_of_positions ?? row.noOfPositions ?? 1,
      submissionRequired: row.submission_required ?? row.submissionRequired ?? 5,
      submissionDone: row.submission_done ?? row.submissionDone ?? 0,
      priority: row.urgency || 'Medium',

      remoteJob: row.remote_job ?? row.remoteJob ?? 'No',
      startDate: rawStartDate ? new Date(rawStartDate).toISOString().split('T')[0] : null,
      endDate: rawEndDate ? new Date(rawEndDate).toISOString().split('T')[0] : null,
      hoursPerWeek: row.hours_per_week ?? row.hoursPerWeek ?? 40,
      duration: row.duration || '',

      accountManagerId: row.account_manager_id ?? row.accountManagerId ?? '',
      recruitmentManagerId: row.recruitment_manager_id ?? row.recruitmentManagerId ?? '',
      recruitmentManager: row.recruitment_manager_name ?? row.recruitmentManagerName ?? 'N/A',
      recruiterId: row.recruiter_id ?? row.recruiterId ?? '',
      recruiter: row.recruiter_name ?? row.recruiterName ?? 'N/A',
      createdBy: row.creator_name ?? row.creatorName ?? 'System',
      creatorEmail: row.creator_email ?? row.creatorEmail ?? null,

      industry: row.industry || '',
      degree: row.degree || '',
      expMin: row.exp_min ?? row.expMin ?? 0,
      expMax: row.exp_max ?? row.expMax ?? 10,

      // Computed fields
      submissionsCount: row.submission_done ?? row.submissionDone ?? 0,
      agingDays,
      pipeline: { applied: 0, interviewing: 0, offered: 0 },
      podId: row.pod_id ?? row.podId ?? '',
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
      timingSnapshotAt: rawTimingSnapshotAt ? new Date(rawTimingSnapshotAt).toISOString() : null,
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

    
    const recruiterId = overrides?.recruiterId || currentJob.recruiterId;

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
                recruiterId: recruiterId || null,
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
      if (recruiterId) assignedRecruiters.add(recruiterId);
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
  async updateJob(
    id: string,
    dto: any,
    tenantId: string,
    user: any
  ): Promise<JobProfile> {
    this.logger.log(`Updating job: ${id} for tenant: ${tenantId}`);

    // Fetch the job first to verify existence
    const currentJob = await this.prisma.job.findFirst({
      where: { id, tenantId },
    });
    if (!currentJob) {
      throw new NotFoundException(`Job not found.`);
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

    // Define Tenant Admin, Branch Admin, Delivery Head, or Delegated Permission clearance
    const userPermissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    const isTenantAdmin = userPermissions.includes('tenant:settings') || userPermissions.includes('tenant:manage');
    const isBranchAdmin = 
      userPermissions.includes('branch_admin:manage') ||
      (currentJob.branchId && user?.branchRoles?.[currentJob.branchId]?.some((r: string) => ['TENANT_ADMIN', 'BRANCH_ADMIN'].includes(r)));

    const hasDelegatedAssignPermission = 
      userPermissions.includes('job:assign') ||
      userPermissions.includes('job:assign_recruiter') ||
      userPermissions.includes('job:assign_pod') ||
      userPermissions.includes('job:edit') ||
      userPermissions.includes('job:approve') ||
      userPermissions.includes('pod:edit') ||
      userPermissions.includes('pod:overlap');

    const canAssignAny = isTenantAdmin || isBranchAdmin || hasDelegatedAssignPermission;

    // Fetch the job's current pod mappings
    const jobPods = await this.prisma.jobPod.findMany({ where: { jobId: id }, select: { podId: true } });
    const isUnassignedJob = jobPods.length === 0;

    // If updating recruiter_id, apply validation rules
    if (dto.recruiterId !== undefined) {
      const newRecruiterId = dto.recruiterId;

      if (isUnassignedJob && !canAssignAny) {
        throw new BadRequestException("Unassigned jobs can only be assigned by a Tenant Admin, Branch Admin, or an authorized staff member.");
      }

      if (canAssignAny) {
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
    if (dto.client !== undefined) {
      await this.ensureClientExists(dto.client, tenantId, creatorId);
    }
    if (dto.endClientName !== undefined) {
      await this.ensureClientExists(dto.endClientName, tenantId, creatorId);
    }

    const dataToUpdate: any = {};
    if (dto.title !== undefined) dataToUpdate.jobTitle = dto.title;
    if (dto.location !== undefined) dataToUpdate.jobLocation = dto.location;
    if (dto.type !== undefined) dataToUpdate.jobType = dto.type;
    if (dto.description !== undefined) dataToUpdate.jobDescription = dto.description;
    if (dto.skillsRequired !== undefined) dataToUpdate.skillsRequired = dto.skillsRequired;
    if (dto.secondarySkills !== undefined) dataToUpdate.secondarySkills = dto.secondarySkills;
    if (dto.status !== undefined) dataToUpdate.status = dto.status;
    
    if (dto.state !== undefined) dataToUpdate.state = dto.state;
    if (dto.country !== undefined) dataToUpdate.country = dto.country;
    if (dto.clientJobId !== undefined) dataToUpdate.clientJobId = dto.clientJobId;
    if (dto.visaType !== undefined) dataToUpdate.visaType = dto.visaType;
    if (dto.clientBillRate !== undefined) dataToUpdate.clientBillRate = dto.clientBillRate;
    if (dto.payRate !== undefined) dataToUpdate.payRate = dto.payRate;
    if (dto.taxTerms !== undefined) dataToUpdate.taxTerms = dto.taxTerms;
    
    
    if (dto.noOfPositions !== undefined) dataToUpdate.noOfPositions = dto.noOfPositions;
    if (dto.submissionRequired !== undefined) dataToUpdate.submissionRequired = dto.submissionRequired;
    if (dto.priority !== undefined) dataToUpdate.urgency = dto.priority;
    if (dto.remoteJob !== undefined) dataToUpdate.remoteJob = dto.remoteJob;
    if (dto.startDate !== undefined) dataToUpdate.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) dataToUpdate.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.hoursPerWeek !== undefined) dataToUpdate.hoursPerWeek = dto.hoursPerWeek;
    if (dto.duration !== undefined) dataToUpdate.duration = dto.duration;
    if (dto.accountManagerId !== undefined) dataToUpdate.accountManagerId = await this.resolveUserUuid(dto.accountManagerId, tenantId);
    if (dto.recruitmentManagerId !== undefined) dataToUpdate.recruitmentManagerId = dto.recruitmentManagerId;
    if (dto.recruiterId !== undefined) dataToUpdate.recruiterId = dto.recruiterId;
    
    if (dto.industry !== undefined) dataToUpdate.industry = dto.industry;
    if (dto.degree !== undefined) dataToUpdate.degree = dto.degree;
    if (dto.expMin !== undefined) dataToUpdate.expMin = dto.expMin;
    if (dto.expMax !== undefined) dataToUpdate.expMax = dto.expMax;
    if (dto.respondBy !== undefined) dataToUpdate.respondBy = dto.respondBy ? new Date(dto.respondBy) : null;
    if (dto.noticePeriod !== undefined) dataToUpdate.noticePeriod = dto.noticePeriod;
    if (dto.jobTimezone !== undefined) dataToUpdate.jobTimezone = dto.jobTimezone;
    
    
    
    if (dto.shiftTiming !== undefined) dataToUpdate.shiftTiming = dto.shiftTiming;

    if (Object.keys(dataToUpdate).length > 0) {
      await this.prisma.job.update({
        where: { id },
        data: dataToUpdate,
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
    try {
      if (dto.recruiterId !== undefined && dto.recruiterId) {
        const resolvedRecruiterId = await this.resolveUserUuid(dto.recruiterId, tenantId);
        if (resolvedRecruiterId && resolvedRecruiterId !== currentJob.recruiterId) {
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

  /** Normalize a skill/keyword for comparison: lowercase, collapse punctuation. */
  private normalizeTerm(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** True if a required skill is evidenced in the candidate's skills or resume text. */
  private skillIsPresent(skill: string, candidateSkillSet: Set<string>, rawText: string): boolean {
    const norm = this.normalizeTerm(skill);
    if (!norm) return false;
    if (candidateSkillSet.has(norm)) return true;
    // Word-boundary match against the raw resume text (catches skills the parser missed).
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(rawText || '');
  }

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
    const allSkills = [...primarySkills, ...secondarySkills];

    // 1. Fetch semantic scores (embeddings-based search) first to optimize the DB query pool
    const semanticByEmail = await this.fetchSemanticScores(job);
    const parserOnline = semanticByEmail !== null;
    const semanticEmails = semanticByEmail ? Array.from(semanticByEmail.keys()) : [];

    // 2. Pull the tenant's candidate pool using indexed pre-filtering to scale to 100,000+ candidates
    let filterSql = `
      FROM ats.candidates c
      LEFT JOIN ats.resumes r ON c.resume_record_id = r.id
      WHERE c.tenant_id = $1
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
              c.total_experience_years, c.current_ctc, c.expected_ctc, 
              c.notice_period_days, c.serving_notice, c.last_working_day, 
              c.pan_card, c.preferred_locations, r.raw_text, r.parsed_json
       ${filterSql}`,
      ...queryParams,
    );

    const matches: CandidateMatch[] = candRows.map((row: any) => {
      let candidateSkills: string[] = [];
      if (row.parsed_json) {
        const parsed = typeof row.parsed_json === 'string' ? JSON.parse(row.parsed_json) : row.parsed_json;
        candidateSkills = parsed?.skills || [];
      }
      const skillSet = new Set(candidateSkills.map((s) => this.normalizeTerm(s)));
      const rawText = row.raw_text || '';

      const matchedPrimary = primarySkills.filter((s) => this.skillIsPresent(s, skillSet, rawText));
      const missingPrimary = primarySkills.filter((s) => !matchedPrimary.includes(s));
      const matchedSecondary = secondarySkills.filter((s) => this.skillIsPresent(s, skillSet, rawText));

      const primaryRatio = primarySkills.length ? matchedPrimary.length / primarySkills.length : 0;
      const secondaryRatio = secondarySkills.length ? matchedSecondary.length / secondarySkills.length : 0;
      const skillScore = secondarySkills.length ? (0.8 * primaryRatio + 0.2 * secondaryRatio) : primaryRatio;

      // 1. Experience fit: full credit inside [expMin, expMax]; scaled below min; no penalty above max.
      const years = Number(row.total_experience_years) || 0;
      let expFit = 1;
      if (job.expMin && years < job.expMin) expFit = job.expMin > 0 ? years / job.expMin : 0;
      const expScore = Math.max(0, Math.min(1, expFit));

      // 2. Location & Relocation Fit Score
      let locationScore = 0.5; // Neutral baseline
      const jobLocLower = (job.location || '').toLowerCase();
      const jobRemote = (job.remoteJob || '').toLowerCase();
      const candLocLower = (row.raw_current_location || '').toLowerCase();
      const prefLocs: string[] = Array.isArray(row.preferred_locations) ? row.preferred_locations.map((l: string) => l.toLowerCase()) : [];

      if (jobRemote === 'yes' || jobLocLower.includes('remote') || !job.location) {
        locationScore = 1.0;
      } else if (candLocLower && (jobLocLower.includes(candLocLower) || candLocLower.includes(jobLocLower))) {
        locationScore = 1.0; // Exact location match
      } else if (prefLocs.some((p) => p && (jobLocLower.includes(p) || p.includes(jobLocLower)))) {
        locationScore = 0.9; // Preferred location match
      } else if (job.state && candLocLower.includes((job.state || '').toLowerCase())) {
        locationScore = 0.8; // Same state match
      } else if (job.country && candLocLower.includes((job.country || '').toLowerCase())) {
        locationScore = 0.6; // Same country match
      }

      // 3. Visa / Work Authorization Fit Score
      let visaScore = 0.7; // Neutral baseline
      const jobVisa = (job.visaType || '').toLowerCase();
      const candVisa = (row.work_authorization || '').toLowerCase();

      if (!jobVisa || jobVisa.includes('any') || jobVisa.includes('all')) {
        visaScore = 1.0;
      } else if (candVisa && (jobVisa.includes(candVisa) || candVisa.includes(jobVisa))) {
        visaScore = 1.0; // Direct match
      } else if (candVisa.includes('citizen') || candVisa.includes('green card') || candVisa.includes('gc')) {
        visaScore = 0.95; // Unrestricted work auth
      }

      // 4. CTC / Salary Budget Fit Score
      let ctcScore = 1.0; // Baseline
      const candExpectedCtc = row.expected_ctc ? Number(row.expected_ctc) : null;
      
      let minBudget: number | null = null;
      let maxBudget: number | null = null;
      const ctcNumbers = (job.payRate || '').match(/[\d\.]+/g)?.map(Number);
      if (ctcNumbers && ctcNumbers.length >= 2) {
        minBudget = Math.min(ctcNumbers[0], ctcNumbers[1]);
        maxBudget = Math.max(ctcNumbers[0], ctcNumbers[1]);
      } else if (ctcNumbers && ctcNumbers.length === 1) {
        maxBudget = ctcNumbers[0];
      }

      if (maxBudget && candExpectedCtc) {
        if (candExpectedCtc <= maxBudget) {
          ctcScore = 1.0;
        } else {
          const overRatio = candExpectedCtc / maxBudget;
          ctcScore = Math.max(0.2, 1.0 - (overRatio - 1.0) * 2);
        }
      }

      // 5. Multi-dimensional Profile Match Weighting
      let score01 = 0.45 * skillScore + 0.15 * expScore + 0.15 * locationScore + 0.15 * visaScore + 0.10 * ctcScore;

      // Blend semantic similarity (30%) when available.
      const semantic = semanticByEmail?.get((row.email || '').toLowerCase()) ?? null;
      if (semantic !== null && semantic !== undefined) {
        score01 = 0.7 * score01 + 0.3 * semantic;
      }

      const matchScore = Math.round(score01 * 100);
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
        experienceYears: years,
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
          experienceFit: Math.round(expScore * 100),
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

  /**
   * Best-effort call to the Python parser's semantic search. Returns a map of
   * lowercased email -> similarity (0-1), or null if the parser is unreachable.
   */
  private async fetchSemanticScores(job: JobProfile): Promise<Map<string, number> | null> {
    const query = [job.jobTitle, ...(job.skillsRequired || [])].filter(Boolean).join(', ');
    if (!query) return null;

    const hosts = ['http://api:8000', 'http://localhost:8000'];
    for (const host of hosts) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const url = `${host}/api/v1/search?query=${encodeURIComponent(query)}&top_k=100&threshold=0`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
          this.logger.warn(`Semantic search at ${host} returned status ${res.status}`);
          continue;
        }
        const data: any = await res.json();
        const results: any[] = data?.results || data?.candidates || [];
        const map = new Map<string, number>();
        for (const r of results) {
          const email = (r.email || r.contact_email || '').toLowerCase();
          const sim = typeof r.similarity === 'number' ? r.similarity
            : typeof r.score === 'number' ? r.score : null;
          if (email && sim !== null) map.set(email, Math.max(0, Math.min(1, sim)));
        }
        return map;
      } catch (err: any) {
        this.logger.warn(`Failed to connect to parser semantic search at ${host}: ${err.message}`);
      }
    }
    return null;
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
      jobTitle: jobTitle || 'Senior Java Developer',
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
      
      location: original.location,
      state: original.state,
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
      submissionRequired: original.submissionRequired || 5,
      priority: original.priority || 'Medium',
      remoteJob: original.remoteJob || 'No',
      duration: original.duration || '',
      hoursPerWeek: original.hoursPerWeek || 40,
      industry: original.industry || '',
      degree: original.degree || '',
      expMin: (original as any).expMin ?? (original as any).experienceMin ?? 0,
      expMax: (original as any).expMax ?? (original as any).experienceMax ?? 10,
      market: (original as any).market || 'IN',
    };

    return this.createJob(duplicateDto, tenantId, user?.email, branchId);
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
    if (sourceBranchId === dto.targetBranchId) throw new BadRequestException('Cannot delegate to the same branch');

    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, branchId: sourceBranchId },
    });

    if (!job) throw new NotFoundException('Job not found or does not belong to your branch');

    // Check if pending request already exists
    const existingReq = await this.prisma.jobDelegationRequest.findFirst({
      where: { jobId, targetBranchId: dto.targetBranchId as string, status: 'PENDING' },
    });
    if (existingReq) throw new BadRequestException('A pending delegation request already exists for this branch');

    const req = await this.prisma.jobDelegationRequest.create({
      data: {
        tenantId,
        jobId,
        sourceBranchId,
        targetBranchId: dto.targetBranchId as string,
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
      targetId: dto.targetBranchId,
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

    return this.prisma.jobDelegationRequest.findMany({
      where: whereClause,
      include: {
        job: { select: { id: true, jobCode: true, jobTitle: true, isCoSourced: true } },
        sourceBranch: { select: { id: true, name: true } },
        targetBranch: { select: { id: true, name: true } },
        assignedPod: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
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
