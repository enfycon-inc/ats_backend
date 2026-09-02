import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';
import { AuthUser } from '../auth/interfaces/auth-user.interface';

export interface SubmissionDetails {
  id: number;
  tenantId: string;
  jobId: string;
  candidateId: number;
  recruiterId: string;
  l1Status: string;
  l1Date: string | null;
  l2Status: string | null;
  l2Date: string | null;
  l3Status: string | null;
  l3Date: string | null;
  finalStatus: string;
  remarks: string | null;
  recruiterComment: string | null;
  podLeadRemarks?: string | null;
  reviewFeedback?: string | null;
  l1Remarks?: string | null;
  l1Interviewer?: string | null;
  l2Remarks?: string | null;
  l2Interviewer?: string | null;
  l3Remarks?: string | null;
  l3Interviewer?: string | null;
  meetingLink?: string | null;
  createdAt: string;
  updatedAt: string;
  
  // Joined fields
  candidateName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateCurrentLocation?: string;
  candidateExperience?: number | null;
  candidateDesignation?: string | null;
  candidateWorkAuth?: string | null;
  candidateSource?: string | null;
  candidateCurrentCtc?: string | null;
  candidateExpectedCtc?: string | null;
  candidateNoticePeriod?: number | null;
  jobCode?: string;
  jobTitle?: string;
  clientName?: string;
  endClientName?: string;
  recruiterName?: string;
  podHeadName?: string;
  accountManagerName?: string;
  submittedRate?: string | null;
  market?: string;
  branchId?: string | null;
}

@Injectable()
export class RecruiterSubmissionsService implements OnModuleInit {
  private readonly logger = new Logger(RecruiterSubmissionsService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.ensureSubmittedRateColumn();
  }

  private async ensureSubmittedRateColumn() {
    try {
      await this.db.query(`
        ALTER TABLE recruiter_submissions
          ADD COLUMN IF NOT EXISTS submitted_rate VARCHAR(100),
          ADD COLUMN IF NOT EXISTS meeting_link TEXT,
          ADD COLUMN IF NOT EXISTS l1_remarks TEXT,
          ADD COLUMN IF NOT EXISTS l1_interviewer VARCHAR(255),
          ADD COLUMN IF NOT EXISTS l2_remarks TEXT,
          ADD COLUMN IF NOT EXISTS l2_interviewer VARCHAR(255),
          ADD COLUMN IF NOT EXISTS l3_remarks TEXT,
          ADD COLUMN IF NOT EXISTS l3_interviewer VARCHAR(255),
          ADD COLUMN IF NOT EXISTS pod_lead_remarks TEXT,
          ADD COLUMN IF NOT EXISTS review_feedback TEXT;
      `);

      // Tenant Custom Stage Remarks table
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS tenant_stage_remarks (
          id SERIAL PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          stage VARCHAR(50) NOT NULL,
          remark_text TEXT NOT NULL,
          created_by VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tenant_stage_remarks_tenant ON tenant_stage_remarks(tenant_id, stage);
      `);
      
      // Auto-heal account_manager_id on jobs table to link created_by / AM string to user IDs
      try {
        await this.db.query(`
          UPDATE jobs j
          SET account_manager_id = u.id::text
          FROM users u
          WHERE (j.account_manager_id IS NULL OR j.account_manager_id = '' OR LOWER(j.account_manager_id) = LOWER(u.full_name) OR LOWER(j.account_manager_id) = LOWER(u.email))
            AND (LOWER(j.created_by) = LOWER(u.email) OR LOWER(j.created_by) = LOWER(u.full_name) OR LOWER(j.account_manager_id) = LOWER(u.full_name))
        `);
      } catch (e) {}

      // Auto-seed default stage remarks for any tenants that have not seeded them
      try {
        const DEFAULT_REMARKS: { stage: string; text: string }[] = [
          // review
          { stage: 'review', text: 'NA' },
          { stage: 'review', text: 'Internal Screening NA - Submitted to Client' },
          { stage: 'review', text: 'Internal Screening Pending' },
          { stage: 'review', text: 'Internal Screening Scheduled' },
          { stage: 'review', text: 'Candidate Noshow' },
          { stage: 'review', text: 'Internal Screening Rescheduled' },
          { stage: 'review', text: 'Internal Screening Completed - Pending Feedback' },
          { stage: 'review', text: 'Selected in Internal Screening - Position went on Hold' },
          { stage: 'review', text: 'Selected in Internal Screening - Submitted to Client' },
          { stage: 'review', text: 'Selected in Internal Screening - Yet to Submit to Client' },
          { stage: 'review', text: 'Rejected in Internal Screening' },
          { stage: 'review', text: 'Candidate Not Responding' },
          { stage: 'review', text: 'Selected in Internal Screening - Position Closed by Client' },
          { stage: 'review', text: 'Rejected - Duplicate' },
          // l1
          { stage: 'l1', text: '✓ Mandatory skills & tech stack 100% verified against JD' },
          { stage: 'l1', text: '✓ Immediate joiner — notice period ≤ 30 days confirmed' },
          { stage: 'l1', text: '✓ Valid work authorization & visa verified' },
          { stage: 'l1', text: '✓ Candidate CTC expectation within approved budget bracket' },
          { stage: 'l1', text: '✓ Excellent communication & profile presentation' },
          { stage: 'l1', text: '✕ Rejected: Notice period exceeds 60 days (Client requires immediate)' },
          { stage: 'l1', text: '✕ Rejected: Significant skill gap in core mandatory technologies' },
          { stage: 'l1', text: '✕ Rejected: Expected CTC exceeds maximum budget ceiling' },
          { stage: 'l1', text: '✕ Rejected: Location constraint / Candidate unwilling to relocate' },
          // l2
          { stage: 'l2', text: '✓ Passed technical screening call with strong hands-on coding' },
          { stage: 'l2', text: '✓ Excellent project depth & system architecture knowledge' },
          { stage: 'l2', text: '✓ Solved technical live coding & algorithmic challenge' },
          { stage: 'l2', text: '✓ Strong technical communication & problem solving' },
          { stage: 'l2', text: '✕ Rejected: Failed live coding / technical screening assessment' },
          { stage: 'l2', text: '✕ Rejected: Lacked depth in framework fundamentals & design patterns' },
          { stage: 'l2', text: '✕ Rejected: Hands-on experience does not match claimed CV experience' },
          // l3
          { stage: 'l3', text: '✓ Commercials & rate margin verified (>20% Gross Margin)' },
          { stage: 'l3', text: '✓ Candidate rate confirmation email on record' },
          { stage: 'l3', text: '✓ Client submission package formatted and validated' },
          { stage: 'l3', text: '✓ Candidate available & briefed on client interview process' },
          { stage: 'l3', text: '✕ Rejected: Commercial margin below minimum threshold (<15%)' },
          { stage: 'l3', text: '✕ Rejected: Candidate declined rate confirmation / demanded higher CTC' },
          // final
          { stage: 'final', text: '✓ Client shortlisted for Round 1 Interview' },
          { stage: 'final', text: '✓ Client interview round completed successfully' },
          { stage: 'final', text: '✓ Client released official offer letter' },
          { stage: 'final', text: '✓ Candidate accepted offer & joined client successfully' },
          { stage: 'final', text: '✕ Client rejected: Profile not aligned with hiring manager expectations' },
          { stage: 'final', text: '✕ Candidate declined offer / accepted counter-offer' },
          { stage: 'final', text: '✕ Position closed / Put on hold by client' },
        ];

        await this.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_stage_remarks_uniq ON tenant_stage_remarks(tenant_id, stage, remark_text)`);
        const tenantsRes = await this.db.query('SELECT id FROM tenants');
        const values: string[] = [];
        const params: any[] = [];
        let pIdx = 1;

        for (const t of tenantsRes.rows) {
          for (const item of DEFAULT_REMARKS) {
            values.push(`($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, 'system')`);
            params.push(t.id, item.stage, item.text);
            pIdx += 3;
          }
        }

        if (values.length > 0) {
          await this.db.query(
            `INSERT INTO tenant_stage_remarks (tenant_id, stage, remark_text, created_by)
             VALUES ${values.join(', ')}
             ON CONFLICT (tenant_id, stage, remark_text) DO NOTHING`,
            params
          );
        }
      } catch (seedErr: any) {
        this.logger.warn(`Could not seed default tenant stage remarks: ${seedErr.message}`);
      }

      this.logger.log('recruiter_submissions database verified (interview, custom remarks & meeting_link check).');
    } catch (err: any) {
      this.logger.error(`Database migration check note: ${err.message}`);
    }
  }

  /**
   * Create a new recruiter submission
   */
  async create(dto: CreateSubmissionDto, tenantId: string, user?: AuthUser, activeBranchId?: string | null): Promise<SubmissionDetails> {
    this.logger.log(`Creating submission for Candidate ID=${dto.candidateId} against Job ID=${dto.jobId} under tenant: ${tenantId}`);

    // 1. Verify job exists and belongs to the tenant, and check if it is active
    const jobResult = await this.db.query(
      'SELECT id, job_code, status, job_title FROM jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [dto.jobId, tenantId]
    );
    if (jobResult.rows.length === 0) {
      throw new BadRequestException(`Job with ID ${dto.jobId} not found under active tenant.`);
    }
    const job = jobResult.rows[0];

    if (job.status?.toUpperCase() !== 'ACTIVE') {
      throw new ForbiddenException(
        `Submissions are blocked. This job is currently in '${job.status}' status and only ACTIVE jobs accept new submissions.`
      );
    }

    // 2. Verify candidate exists and belongs to the tenant
    const candidateResult = await this.db.query(
      'SELECT id, full_name, email FROM candidates WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [dto.candidateId, tenantId]
    );
    if (candidateResult.rows.length === 0) {
      throw new BadRequestException(`Candidate with ID ${dto.candidateId} not found under active tenant.`);
    }

    // 3. Process L1/L2/L3 sequential auto-rejection for initial create (if overrides are passed)
    let finalStatus = dto.finalStatus || 'SUBMITTED';
    let l1Status = dto.l1Status || 'PENDING';
    let l2Status = dto.l2Status || null;
    let l3Status = dto.l3Status || null;
    let l1Date = dto.l1Date ? new Date(dto.l1Date) : null;
    let l2Date = dto.l2Date ? new Date(dto.l2Date) : null;
    let l3Date = dto.l3Date ? new Date(dto.l3Date) : null;

    if (l1Status === 'REJECTED') {
      finalStatus = 'REJECTED';
      l2Status = null;
      l2Date = null;
      l3Status = null;
      l3Date = null;
    } else if (l2Status === 'REJECTED') {
      finalStatus = 'REJECTED';
      l3Status = null;
      l3Date = null;
    } else if (l3Status === 'REJECTED') {
      finalStatus = 'REJECTED';
    } else if (finalStatus !== 'REJECTED' && finalStatus !== 'OFFER' && finalStatus !== 'JOIN') {
      // Check recruiter role and pod for PENDING_APPROVAL workflow
      const recruiterRes = await this.db.query(
        'SELECT role_id, pod_id, (SELECT system_role FROM custom_roles WHERE id = users.role_id) as system_role FROM users WHERE id = $1 AND tenant_id = $2',
        [dto.recruiterId, tenantId]
      );
      
      if (recruiterRes.rows.length > 0) {
        const recruiter = recruiterRes.rows[0];
        const podId = recruiter.pod_id;
        const systemRole = recruiter.system_role;

        // If user is a regular RECRUITER (not POD_LEAD, not ACCOUNT_MANAGER) and belongs to a pod
        if (systemRole === 'RECRUITER' && podId) {
          finalStatus = 'PENDING_APPROVAL';
        }
      }
    }

    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');

      // 4. Insert submission
      const sql = `
        INSERT INTO recruiter_submissions (
          tenant_id, job_id, candidate_id, recruiter_id,
          l1_status, l1_date, l2_status, l2_date, l3_status, l3_date,
          final_status, remarks, recruiter_comment, submitted_rate, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
        RETURNING *
      `;

      const params = [
        tenantId,
        dto.jobId,
        dto.candidateId,
        dto.recruiterId,
        l1Status,
        l1Date,
        l2Status,
        l2Date,
        l3Status,
        l3Date,
        finalStatus,
        dto.remarks || null,
        dto.recruiterComment || null,
        dto.submittedRate || null,
      ];

      const insertResult = await client.query(sql, params);
      const submission = insertResult.rows[0];

      // 5. Auto-increment submission count on Job
      await client.query(
        'UPDATE jobs SET submission_done = submission_done + 1 WHERE id = $1 AND tenant_id = $2',
        [dto.jobId, tenantId]
      );

      await client.query('COMMIT');

      return this.mapRowToDetails({
        ...submission,
        candidate_name: candidateResult.rows[0].full_name,
        candidate_email: candidateResult.rows[0].email,
        job_code: job.job_code,
        job_title: job.job_title,
      });

    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to create recruiter submission: ${err.message}`, err.stack);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Find and paginate submissions with filters, scoped by tenant
   */
  async findAll(
    tenantId: string,
    user: AuthUser,
    filters: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
      l1Status?: string;
      l2Status?: string;
      l3Status?: string;
      finalStatus?: string;
      jobId?: string;
      candidateId?: number;
      branchId?: string;
    }
  ) {
    this.logger.log(`Listing submissions for tenant: ${tenantId} under user role visibility`);

    let baseSql = `
      SELECT 
        s.*,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.raw_current_location AS candidate_current_location,
        c.total_experience_years AS candidate_experience,
        c.raw_current_designation AS candidate_designation,
        c.work_authorization AS candidate_work_auth,
        c.source AS candidate_source,
        c.candidate_code AS candidate_code,
        COALESCE(c.uploaded_by_name, 'System') AS candidate_uploader_name,
        c.current_ctc AS candidate_current_ctc,
        c.expected_ctc AS candidate_expected_ctc,
        c.notice_period_days AS candidate_notice_period,
        j.job_code,
        j.job_title,
        j.client_name,
        j.end_client_name,
        j.market,
        j.branch_id AS branch_id,
        r.full_name AS recruiter_name,
        ph.full_name AS pod_head_name,
        COALESCE(am.full_name, cb.full_name, j.account_manager_id) AS am_name
      FROM recruiter_submissions s
      LEFT JOIN candidates c ON s.candidate_id = c.id
      LEFT JOIN jobs j ON s.job_id = j.id
      LEFT JOIN users r ON s.recruiter_id = r.id::text
      LEFT JOIN pods p ON r.pod_id = p.id
      LEFT JOIN users ph ON p.pod_head_id = ph.id
      LEFT JOIN users am ON (
        j.account_manager_id = am.id::text 
        OR LOWER(j.account_manager_id) = LOWER(am.email) 
        OR LOWER(j.account_manager_id) = LOWER(am.full_name)
      )
      LEFT JOIN users cb ON (
        j.created_by = cb.id::text 
        OR LOWER(j.created_by) = LOWER(cb.email) 
        OR LOWER(j.created_by) = LOWER(cb.full_name)
      )
      WHERE s.tenant_id = $1
    `;

    const params: any[] = [tenantId];
    let paramIndex = 2;

    const userPerms = user.permissions || [];
    const isAm = user.roles?.includes('ACCOUNT_MANAGER');
    const isAdmin = user.roles?.includes('ADMIN') || user.roles?.includes('SUPER_ADMIN');
    const isDeliveryHead = user.roles?.includes('DELIVERY_HEAD');
    const isRecruiter = user.roles?.includes('RECRUITER');
    const isPodLead = user.roles?.includes('POD_LEAD');

    const canViewAll = isAdmin || isDeliveryHead || userPerms.includes('submission:view') || userPerms.includes('submission:audit_rounds') || userPerms.includes('submission:audit_l1') || userPerms.includes('submission:audit_l2') || userPerms.includes('submission:audit_l3') || userPerms.includes('submission:approve_client');

    if (!canViewAll) {
      const roleConditions: string[] = [];

      if (isRecruiter) {
        roleConditions.push(`s.recruiter_id = $${paramIndex}`);
        params.push(user.dbId);
        paramIndex++;
      }

      if (isPodLead) {
        roleConditions.push(`s.recruiter_id IN (SELECT id::text FROM users WHERE pod_id IN (SELECT id FROM pods WHERE pod_head_id = $${paramIndex}))`);
        params.push(user.dbId);
        paramIndex++;
      }

      if (isAm) {
        roleConditions.push(
          `(
            j.account_manager_id = $${paramIndex}
            OR LOWER(j.account_manager_id) = LOWER($${paramIndex + 1})
            OR LOWER(j.account_manager_id) = LOWER($${paramIndex + 2})
            OR LOWER(j.created_by) = LOWER($${paramIndex + 1})
            OR LOWER(j.created_by) = LOWER($${paramIndex + 2})
            OR s.recruiter_id = $${paramIndex}
            OR LOWER(s.recruiter_id) = LOWER($${paramIndex + 1})
          )`
        );
        params.push(user.dbId, user.email || '', user.fullName || '');
        paramIndex += 3;
      }

      if (roleConditions.length > 0) {
        baseSql += ` AND (${roleConditions.join(' OR ')})`;
      } else {
        baseSql += ` AND 1=0`;
      }
    }

    if (filters.jobId) {
      baseSql += ` AND s.job_id = $${paramIndex}`;
      params.push(filters.jobId);
      paramIndex++;
    }

    if (filters.candidateId) {
      baseSql += ` AND s.candidate_id = $${paramIndex}`;
      params.push(filters.candidateId);
      paramIndex++;
    }

    if (filters.branchId && filters.branchId.trim().length > 0 && filters.branchId !== 'null' && filters.branchId !== 'undefined') {
      baseSql += ` AND (
        j.branch_id::text = $${paramIndex} 
        OR j.branch_id IN (SELECT id FROM branches WHERE LOWER(name) = LOWER($${paramIndex}) OR LOWER(code) = LOWER($${paramIndex}))
        OR LOWER(j.business_unit) LIKE '%' || LOWER($${paramIndex}) || '%'
        OR j.branch_id IS NULL
      )`;
      params.push(filters.branchId.trim());
      paramIndex++;
    }

    if (filters.l1Status) {
      baseSql += ` AND s.l1_status = $${paramIndex}`;
      params.push(filters.l1Status);
      paramIndex++;
    }

    if (filters.l2Status) {
      baseSql += ` AND s.l2_status = $${paramIndex}`;
      params.push(filters.l2Status);
      paramIndex++;
    }

    if (filters.l3Status) {
      baseSql += ` AND s.l3_status = $${paramIndex}`;
      params.push(filters.l3Status);
      paramIndex++;
    }

    if (filters.finalStatus) {
      baseSql += ` AND s.final_status = $${paramIndex}`;
      params.push(filters.finalStatus);
      paramIndex++;
    }

    if (filters.startDate && filters.startDate !== 'undefined' && filters.startDate !== 'null') {
      const start = new Date(filters.startDate);
      if (!isNaN(start.getTime())) {
        baseSql += ` AND s.created_at >= $${paramIndex}`;
        params.push(start);
        paramIndex++;
      }
    }

    if (filters.endDate && filters.endDate !== 'undefined' && filters.endDate !== 'null') {
      const end = new Date(filters.endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        baseSql += ` AND s.created_at <= $${paramIndex}`;
        params.push(end);
        paramIndex++;
      }
    }

    baseSql += ' ORDER BY s.created_at DESC';

    // Pagination
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(Math.max(1, filters.limit || 20), 100);
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*) FROM (${baseSql}) AS counted`;
    
    // Add LIMIT and OFFSET for retrieval
    const retrieveSql = `${baseSql} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const retrieveParams = [...params, limit, offset];

    try {
      this.logger.debug(`[findAll] countSql: ${countSql}`);
      this.logger.debug(`[findAll] params: ${JSON.stringify(params)}`);
      this.logger.debug(`[findAll] user.dbId=${user.dbId}, roles=${JSON.stringify(user.roles)}`);
      const [countRes, retrieveRes] = await Promise.all([
        this.db.query(countSql, params),
        this.db.query(retrieveSql, retrieveParams),
      ]);

      const total = parseInt(countRes.rows[0].count, 10);
      const data = retrieveRes.rows.map((row) => this.mapRowToDetails(row));

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (err) {
      this.logger.error(`Failed to retrieve submissions: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Find a single recruiter submission by ID
   */
  async findOne(id: number, tenantId: string): Promise<SubmissionDetails> {
    this.logger.log(`Fetching submission ID=${id} for tenant: ${tenantId}`);

    const sql = `
      SELECT 
        s.*,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.raw_current_location AS candidate_current_location,
        c.total_experience_years AS candidate_experience,
        c.raw_current_designation AS candidate_designation,
        c.work_authorization AS candidate_work_auth,
        c.source AS candidate_source,
        c.current_ctc AS candidate_current_ctc,
        c.expected_ctc AS candidate_expected_ctc,
        c.notice_period_days AS candidate_notice_period,
        j.job_code,
        j.job_title,
        j.client_name,
        j.end_client_name,
        j.market,
        j.branch_id AS branch_id,
        r.full_name AS recruiter_name,
        ph.full_name AS pod_head_name,
        COALESCE(am.full_name, cb.full_name, j.account_manager_id) AS am_name
      FROM recruiter_submissions s
      LEFT JOIN candidates c ON s.candidate_id = c.id
      LEFT JOIN jobs j ON s.job_id = j.id
      LEFT JOIN users r ON s.recruiter_id = r.id::text
      LEFT JOIN pods p ON r.pod_id = p.id
      LEFT JOIN users ph ON p.pod_head_id = ph.id
      LEFT JOIN users am ON (
        j.account_manager_id = am.id::text 
        OR LOWER(j.account_manager_id) = LOWER(am.email) 
        OR LOWER(j.account_manager_id) = LOWER(am.full_name)
      )
      LEFT JOIN users cb ON (
        j.created_by = cb.id::text 
        OR LOWER(j.created_by) = LOWER(cb.email) 
        OR LOWER(j.created_by) = LOWER(cb.full_name)
      )
      WHERE s.id = $1 AND s.tenant_id = $2
      LIMIT 1
    `;

    const res = await this.db.query(sql, [id, tenantId]);
    if (res.rows.length === 0) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    return this.mapRowToDetails(res.rows[0]);
  }



  /**
   * Update submission statuses with auto-rejection logic
   */
  async update(id: number, dto: UpdateSubmissionDto, tenantId: string, user: AuthUser): Promise<SubmissionDetails> {
    this.logger.log(`Updating submission ID=${id} for tenant: ${tenantId}`);

    // Retrieve existing submission and AM ID
    const existingResult = await this.db.query(
      'SELECT s.*, j.account_manager_id FROM recruiter_submissions s LEFT JOIN jobs j ON s.job_id = j.id WHERE s.id = $1 AND s.tenant_id = $2 LIMIT 1',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    const existing = existingResult.rows[0];

    const userPerms = user.permissions || [];
    const isAdmin = user.roles?.includes('ADMIN') || user.roles?.includes('SUPER_ADMIN');
    const isDeliveryHead = user.roles?.includes('DELIVERY_HEAD');
    const isAm = user.roles?.includes('ACCOUNT_MANAGER');
    const isPodLead = user.roles?.includes('POD_LEAD');

    const canAuditRounds = isAdmin || isDeliveryHead || isAm || userPerms.includes('submission:audit_rounds');
    const canAuditL1 = canAuditRounds || isAm || isPodLead || userPerms.includes('submission:audit_l1');
    const canAuditL2 = canAuditRounds || isAm || userPerms.includes('submission:audit_l2');
    const canAuditL3 = canAuditRounds || isAm || userPerms.includes('submission:audit_l3');
    const canInternalScreen = isAdmin || isDeliveryHead || isPodLead || userPerms.includes('submission:internal_screening');
    const canFinalStatus = isAdmin || isDeliveryHead || isAm || userPerms.includes('submission:final_status');
    const canApproveClient = canInternalScreen || canFinalStatus;
    const canEditRate = isAdmin || isDeliveryHead || isAm || userPerms.includes('submission:edit_rate');

    if (!canAuditL1) {
      delete dto.l1Status;
      delete dto.l1Date;
      delete dto.l1Remarks;
      delete dto.l1Interviewer;
    }
    if (!canAuditL2) {
      delete dto.l2Status;
      delete dto.l2Date;
      delete dto.l2Remarks;
      delete dto.l2Interviewer;
    }
    if (!canAuditL3) {
      delete dto.l3Status;
      delete dto.l3Date;
      delete dto.l3Remarks;
      delete dto.l3Interviewer;
    }
    if (existing.final_status === 'PENDING_APPROVAL' && !canInternalScreen) {
      delete dto.finalStatus;
      delete (dto as any).reviewFeedback;
    } else if (existing.final_status !== 'PENDING_APPROVAL' && (dto.finalStatus === 'OFFER' || dto.finalStatus === 'JOIN') && !canFinalStatus) {
      delete dto.finalStatus;
    } else if (!canApproveClient) {
      delete dto.finalStatus;
    }
    if (!canFinalStatus && !canInternalScreen) {
      delete dto.remarks;
    }
    if (!canEditRate) {
      delete dto.submittedRate;
    }

    // Evaluate merged status changes
    const mergedL1Status = dto.l1Status !== undefined ? dto.l1Status : existing.l1_status;
    const mergedL2Status = dto.l2Status !== undefined ? dto.l2Status : existing.l2_status;
    const mergedL3Status = dto.l3Status !== undefined ? dto.l3Status : existing.l3_status;

    let finalStatus = dto.finalStatus !== undefined ? dto.finalStatus : existing.final_status;
    let l1Status = mergedL1Status;
    let l2Status = mergedL2Status;
    let l3Status = mergedL3Status;

    let l1Date = dto.l1Date !== undefined ? (dto.l1Date ? new Date(dto.l1Date) : null) : existing.l1_date;
    let l2Date = dto.l2Date !== undefined ? (dto.l2Date ? new Date(dto.l2Date) : null) : existing.l2_date;
    let l3Date = dto.l3Date !== undefined ? (dto.l3Date ? new Date(dto.l3Date) : null) : existing.l3_date;

    // Sequential auto-reject & stage blocking rules
    if (l1Status === 'REJECTED') {
      finalStatus = 'REJECTED';
      l2Status = null;
      l2Date = null;
      l3Status = null;
      l3Date = null;
    } else if (l2Status === 'REJECTED') {
      finalStatus = 'REJECTED';
      l3Status = null;
      l3Date = null;
    } else if (l3Status === 'REJECTED') {
      finalStatus = 'REJECTED';
    }

    // Dynamic field list builder for SQL UPDATE
    const updates: string[] = [];
    const params: any[] = [id, tenantId];
    let paramIndex = 3;

    const addField = (colName: string, val: any) => {
      updates.push(`${colName} = $${paramIndex}`);
      params.push(val);
      paramIndex++;
    };

    if (dto.jobId !== undefined) addField('job_id', dto.jobId);
    if (dto.candidateId !== undefined) addField('candidate_id', dto.candidateId);
    if (dto.recruiterId !== undefined) addField('recruiter_id', dto.recruiterId);
    
    addField('l1_status', l1Status);
    addField('l1_date', l1Date);
    addField('l2_status', l2Status);
    addField('l2_date', l2Date);
    addField('l3_status', l3Status);
    addField('l3_date', l3Date);
    addField('final_status', finalStatus);

    if (dto.remarks !== undefined) addField('remarks', dto.remarks);
    if (dto.recruiterComment !== undefined) addField('recruiter_comment', dto.recruiterComment);
    if (dto.submittedRate !== undefined) addField('submitted_rate', dto.submittedRate);
    if (dto.podLeadRemarks !== undefined) addField('pod_lead_remarks', dto.podLeadRemarks);
    if (dto.reviewFeedback !== undefined) {
      addField('review_feedback', dto.reviewFeedback);
      if (dto.podLeadRemarks === undefined) {
        addField('pod_lead_remarks', dto.reviewFeedback);
      }
    }
    if (dto.l1Remarks !== undefined) addField('l1_remarks', dto.l1Remarks);
    if (dto.l1Interviewer !== undefined) addField('l1_interviewer', dto.l1Interviewer);
    if (dto.l2Remarks !== undefined) addField('l2_remarks', dto.l2Remarks);
    if (dto.l2Interviewer !== undefined) addField('l2_interviewer', dto.l2Interviewer);
    if (dto.l3Remarks !== undefined) addField('l3_remarks', dto.l3Remarks);
    if (dto.l3Interviewer !== undefined) addField('l3_interviewer', dto.l3Interviewer);
    if (dto.meetingLink !== undefined) addField('meeting_link', dto.meetingLink);
    
    updates.push('updated_at = NOW()');

    const updateSql = `
      UPDATE recruiter_submissions
      SET ${updates.join(', ')}
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `;

    try {
      const updateResult = await this.db.query(updateSql, params);
      const updatedRow = updateResult.rows[0];

      // Pull fresh candidates / jobs metadata to return mapped details
      const metaResult = await this.db.query(
        `SELECT 
           c.full_name AS candidate_name,
           c.email AS candidate_email,
           c.phone AS candidate_phone,
           c.raw_current_location AS candidate_current_location,
           j.job_code,
           j.job_title,
           j.client_name,
           j.end_client_name
         FROM candidates c, jobs j
         WHERE c.id = $1 AND j.id = $2 LIMIT 1`,
        [updatedRow.candidate_id, updatedRow.job_id]
      );

      const meta = metaResult.rows[0] || {};

      return this.mapRowToDetails({
        ...updatedRow,
        ...meta,
      });

    } catch (err) {
      this.logger.error(`Failed to update recruiter submission: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Delete a recruiter submission, scoped by tenant
   */
  async remove(id: number, tenantId: string): Promise<{ message: string }> {
    this.logger.log(`Removing submission ID=${id} for tenant: ${tenantId}`);

    const existingResult = await this.db.query(
      'SELECT id, job_id FROM recruiter_submissions WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    const { job_id } = existingResult.rows[0];
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Delete submission
      await client.query(
        'DELETE FROM recruiter_submissions WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );

      // 2. Decrement submission count on job
      await client.query(
        'UPDATE jobs SET submission_done = GREATEST(0, submission_done - 1) WHERE id = $1 AND tenant_id = $2',
        [job_id, tenantId]
      );

      await client.query('COMMIT');
      return { message: `Recruiter submission with ID ${id} was deleted successfully.` };

    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to remove recruiter submission ID=${id}: ${err.message}`, err.stack);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve aggregate status counts for recruiter tracker, scoped by tenant
   */
  async getTrackerStats(tenantId: string, user: AuthUser) {
    this.logger.log(`Retrieving aggregate tracker stats for tenant: ${tenantId}`);

    let baseFilter = 'WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    const isAm = user.roles?.includes('ACCOUNT_MANAGER');
    const isAdmin = user.roles?.includes('ADMIN') || user.roles?.includes('SUPER_ADMIN');
    const isDeliveryHead = user.roles?.includes('DELIVERY_HEAD');
    const isRecruiter = user.roles?.includes('RECRUITER');
    const isPodLead = user.roles?.includes('POD_LEAD');

    if (!isAdmin && !isDeliveryHead) {
      const roleConditions: string[] = [];

      if (isRecruiter) {
        roleConditions.push(`recruiter_id = $${paramIndex}`);
        params.push(user.dbId);
        paramIndex++;
      }

      if (isPodLead) {
        roleConditions.push(`recruiter_id IN (SELECT id::text FROM users WHERE pod_id IN (SELECT id FROM pods WHERE pod_head_id = $${paramIndex}))`);
        params.push(user.dbId);
        paramIndex++;
      }

      if (isAm) {
        roleConditions.push(
          `job_id IN (
            SELECT id FROM jobs 
            WHERE account_manager_id = $${paramIndex}
               OR LOWER(account_manager_id) = LOWER($${paramIndex + 1})
               OR LOWER(account_manager_id) = LOWER($${paramIndex + 2})
               OR LOWER(created_by) = LOWER($${paramIndex + 1})
               OR LOWER(created_by) = LOWER($${paramIndex + 2})
          )`
        );
        params.push(user.dbId, user.email || '', user.fullName || '');
        paramIndex += 3;
      }

      if (roleConditions.length > 0) {
        baseFilter += ` AND (${roleConditions.join(' OR ')})`;
      } else {
        baseFilter += ` AND 1=0`;
      }
    }

    const totalSql = `SELECT COUNT(*) FROM recruiter_submissions ${baseFilter}`;
    const l1Sql = `SELECT COUNT(*) FROM recruiter_submissions ${baseFilter} AND l1_status = 'PENDING'`;
    const l2Sql = `SELECT COUNT(*) FROM recruiter_submissions ${baseFilter} AND l2_status = 'PENDING'`;
    const l3Sql = `SELECT COUNT(*) FROM recruiter_submissions ${baseFilter} AND l3_status = 'PENDING'`;

    try {
      const [totalRes, l1Res, l2Res, l3Res] = await Promise.all([
        this.db.query(totalSql, params),
        this.db.query(l1Sql, params),
        this.db.query(l2Sql, params),
        this.db.query(l3Sql, params),
      ]);

      return {
        total: parseInt(totalRes.rows[0].count, 10),
        l1Pending: parseInt(l1Res.rows[0].count, 10),
        l2Pending: parseInt(l2Res.rows[0].count, 10),
        l3Pending: parseInt(l3Res.rows[0].count, 10),
      };
    } catch (err) {
      this.logger.error(`Failed to calculate tracker statistics: ${err.message}`, err.stack);
      return { total: 0, l1Pending: 0, l2Pending: 0, l3Pending: 0 };
    }
  }

  /**
   * Helper mapping from PG row to details object
   */
  private mapRowToDetails(row: any): SubmissionDetails {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      jobId: row.job_id,
      candidateId: row.candidate_id,
      recruiterId: row.recruiter_id,
      l1Status: row.l1_status,
      l1Date: row.l1_date ? new Date(row.l1_date).toISOString() : null,
      l2Status: row.l2_status,
      l2Date: row.l2_date ? new Date(row.l2_date).toISOString() : null,
      l3Status: row.l3_status,
      l3Date: row.l3_date ? new Date(row.l3_date).toISOString() : null,
      finalStatus: row.final_status,
      remarks: row.remarks,
      recruiterComment: row.recruiter_comment,
      podLeadRemarks: row.pod_lead_remarks || row.review_feedback || null,
      reviewFeedback: row.review_feedback || row.pod_lead_remarks || null,
      l1Remarks: row.l1_remarks || null,
      l1Interviewer: row.l1_interviewer || null,
      l2Remarks: row.l2_remarks || null,
      l2Interviewer: row.l2_interviewer || null,
      l3Remarks: row.l3_remarks || null,
      l3Interviewer: row.l3_interviewer || null,
      meetingLink: row.meeting_link || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      candidatePhone: row.candidate_phone,
      candidateCurrentLocation: row.candidate_current_location,
      candidateExperience: row.candidate_experience,
      candidateDesignation: row.candidate_designation,
      candidateWorkAuth: row.candidate_work_auth,
      candidateSource: row.candidate_source,
      candidateCurrentCtc: row.candidate_current_ctc,
      candidateExpectedCtc: row.candidate_expected_ctc,
      candidateNoticePeriod: row.candidate_notice_period,
      jobCode: row.job_code,
      jobTitle: row.job_title,
      clientName: row.client_name,
      endClientName: row.end_client_name,
      recruiterName: row.recruiter_name,
      podHeadName: row.pod_head_name,
      accountManagerName: row.am_name,
      submittedRate: row.submitted_rate,
      market: row.market,
      branchId: row.branch_id || null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Tenant & Branch Custom Stage Remarks Configuration Methods
  // ─────────────────────────────────────────────────────────────
  async getCustomRemarks(tenantId: string, branchId?: string, includeGlobal?: boolean) {
    let shouldIncludeGlobal = includeGlobal;
    let resolvedBranchId = branchId?.trim();

    if (resolvedBranchId && resolvedBranchId !== 'null' && resolvedBranchId !== 'undefined') {
      try {
        const branchRes = await this.db.query(
          'SELECT id, enable_global_remarks FROM branches WHERE id::text = $1 OR LOWER(name) = LOWER($1) OR LOWER(code) = LOWER($1)',
          [resolvedBranchId]
        );
        if (branchRes.rows.length > 0) {
          resolvedBranchId = branchRes.rows[0].id;
          if (shouldIncludeGlobal === undefined) {
            shouldIncludeGlobal = Boolean(branchRes.rows[0].enable_global_remarks);
          }
        }
      } catch {
        // fallback
      }
    } else {
      resolvedBranchId = undefined;
      if (shouldIncludeGlobal === undefined) {
        shouldIncludeGlobal = true;
      }
    }

    let query = `
      SELECT id, stage, remark_text as "remarkText", 
             COALESCE(remark_type, 'GENERAL') as "remarkType",
             branch_id as "branchId", 
             COALESCE(is_global, branch_id IS NULL) as "isGlobal",
             created_by as "createdBy", created_at as "createdAt"
      FROM tenant_stage_remarks
      WHERE tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (resolvedBranchId) {
      params.push(resolvedBranchId);
      if (shouldIncludeGlobal) {
        query += ` AND (branch_id = $2 OR branch_id IS NULL OR is_global = TRUE)`;
      } else {
        query += ` AND (branch_id = $2 OR (branch_id IS NULL AND is_global = TRUE AND NOT EXISTS (SELECT 1 FROM tenant_stage_remarks tsr2 WHERE tsr2.tenant_id = $1 AND tsr2.branch_id = $2 AND tsr2.stage = tenant_stage_remarks.stage)))`;
      }
    }
    query += ` ORDER BY id ASC`;

    const result = await this.db.query(query, params);
    return result.rows;
  }

  async createCustomRemark(
    tenantId: string, 
    stage: string, 
    remarkText: string, 
    remarkType: string = 'GENERAL', 
    branchId?: string, 
    createdBy?: string,
    isGlobal?: boolean
  ) {
    if (!stage || !remarkText?.trim()) {
      throw new BadRequestException('Stage and remarkText are required.');
    }
    const cleanStage = stage.toLowerCase().trim();
    const cleanType = (remarkType || 'GENERAL').toUpperCase().trim();
    const cleanBranchId = branchId?.trim() || null;
    const cleanIsGlobal = Boolean(isGlobal || (!cleanBranchId));

    // Support comma or newline separated multiple remarks in a single submission
    const rawRemarks = remarkText.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    const results: any[] = [];

    for (const text of (rawRemarks.length > 0 ? rawRemarks : [remarkText.trim()])) {
      const result = await this.db.query(
        `INSERT INTO tenant_stage_remarks (tenant_id, stage, remark_text, remark_type, branch_id, is_global, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, stage, remark_text as "remarkText", remark_type as "remarkType", branch_id as "branchId", is_global as "isGlobal", created_by as "createdBy", created_at as "createdAt"`,
        [tenantId, cleanStage, text, cleanType, cleanBranchId, cleanIsGlobal, createdBy || 'admin']
      );
      results.push(result.rows[0]);
    }

    return results.length === 1 ? results[0] : results;
  }

  async deleteCustomRemark(tenantId: string, id: number) {
    const result = await this.db.query(
      `DELETE FROM tenant_stage_remarks WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`Custom remark template #${id} not found.`);
    }
    return { message: `Custom remark #${id} deleted successfully.`, id };
  }
}
