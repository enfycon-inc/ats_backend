import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateJobDto } from './dtos/create-job.dto';

export interface JobProfile {
  id: string;
  jobCode: string;
  jobTitle: string;
  businessUnit: string;
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

  // Rates & terms
  visaType: string;
  clientBillRate: string;
  payRate: string;
  taxTerms: string;

  // Client hierarchy
  endClientName: string;

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
  primaryRecruiterId: string;
  primaryRecruiter: string;
  assignedTo: string;
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
  respondBy?: string | null;
  noticePeriod?: string;
}

/** A single candidate ranked against a job requisition. */
export interface CandidateMatch {
  candidateId: number;
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

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.ensureJobsTableV2();
  }

  /**
   * Expanded jobs table with all Ceipal-matching columns
   */
  private async ensureJobsTableV2() {
    // Add new columns if they don't exist (idempotent ALTER TABLE)
    const alterStatements = [
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS business_unit VARCHAR(255) DEFAULT 'enfysync Inc'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT ''`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'United States'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_job_id VARCHAR(100) DEFAULT 'N/A'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recruitment_manager_id UUID`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS primary_recruiter_id UUID`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255) DEFAULT 'N/A'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tax_terms VARCHAR(50) DEFAULT 'C2C'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remote_job VARCHAR(20) DEFAULT 'No'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_date DATE`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS end_date DATE`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hours_per_week INT DEFAULT 40`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duration VARCHAR(100) DEFAULT ''`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS secondary_skills TEXT[] DEFAULT '{}'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS industry VARCHAR(100) DEFAULT ''`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS degree VARCHAR(100) DEFAULT ''`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS exp_min INT DEFAULT 0`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS exp_max INT DEFAULT 10`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_by VARCHAR(255) DEFAULT 'System'`,
      `ALTER TABLE jobs ALTER COLUMN visa_type TYPE VARCHAR(500)`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS respond_by DATE`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notice_period VARCHAR(100) DEFAULT ''`,
    ];

    for (const stmt of alterStatements) {
      try {
        await this.db.query(stmt);
      } catch (err) {
        // Ignore errors for existing columns
        this.logger.debug(`Schema migration note: ${err.message}`);
      }
    }

    this.logger.log('Jobs table V2 schema verified (all Ceipal fields present).');
  }
  async getNextJobCode(tenantId: string, offset = 0): Promise<string> {
    const tenantRes = await this.db.query('SELECT domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    let tenantPrefix = 'ENFY';
    if (tenantRes.rows.length > 0) {
      const domain = tenantRes.rows[0].domain || 'enfy';
      const cleanDomain = domain.toLowerCase().endsWith('.com') ? domain.slice(0, -4) : domain;
      tenantPrefix = (cleanDomain === 'temp' || !cleanDomain) ? 'ENFY' : cleanDomain.substring(0, 4).toUpperCase();
    }

    const date = new Date();
    const yy = date.getFullYear().toString().slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = `${tenantPrefix}-JOB-${yy}${mm}-`;

    const jobsRes = await this.db.query(
      'SELECT job_code FROM jobs WHERE tenant_id = $1 AND job_code LIKE $2',
      [tenantId, `${prefix}%`]
    );

    let maxSequence = 0;
    for (const row of jobsRes.rows) {
      const jobCodeStr = row.job_code;
      const sequenceStr = jobCodeStr.split('-').pop();
      if (sequenceStr && !isNaN(parseInt(sequenceStr, 10))) {
        const seq = parseInt(sequenceStr, 10);
        if (seq > maxSequence) {
          maxSequence = seq;
        }
      }
    }

    const nextSeq = maxSequence + 1 + offset;
    const seqStr = String(nextSeq).padStart(5, '0');
    return `${prefix}${seqStr}`;
  }

  /**
   * Create a new job requisition
   */
  async createJob(dto: CreateJobDto, tenantId: string, createdByEmail?: string): Promise<JobProfile> {
    this.logger.log(`Creating job: ${dto.title} for tenant: ${tenantId}`);

    // Generate unique sequential PREFIXJOB-YYMM-XXXXX job code using the exact logic from enfysync_backend
    let jobCode = '';
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      jobCode = await this.getNextJobCode(tenantId, attempts);
      const check = await this.db.query('SELECT 1 FROM jobs WHERE job_code = $1', [jobCode]);
      if (check.rows.length === 0) {
        isUnique = true;
      } else {
        attempts++;
      }
    }
    if (!isUnique) throw new Error('Failed to generate unique sequential job code.');

    const sql = `
      INSERT INTO jobs (
        tenant_id, job_code, job_title, job_location, job_type, job_description,
        skills_required, secondary_skills, status,
        business_unit, state, country, client_job_id,
        visa_type, client_bill_rate, pay_rate, tax_terms,
        client_name, end_client_name,
        no_of_positions, submission_required, submission_done, urgency,
        remote_job, start_date, end_date, hours_per_week, duration,
        account_manager_id, recruitment_manager_id, primary_recruiter_id, assigned_to,
        industry, degree, exp_min, exp_max, created_by,
        respond_by, notice_period,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19,
        $20, $21, 0, $22,
        $23, $24, $25, $26, $27,
        $28, $29, $30, $31,
        $32, $33, $34, $35, $36,
        $37, $38,
        NOW(), NOW()
      ) RETURNING *
    `;

    const params = [
      tenantId,                                                     // $1
      jobCode,                                                       // $2
      dto.title,                                                     // $3
      dto.location,                                                  // $4
      dto.type,                                                      // $5
      dto.description,                                               // $6
      dto.skillsRequired || [],                                      // $7
      dto.secondarySkills || [],                                     // $8
      dto.status || 'Active',                                        // $9
      dto.businessUnit || 'enfysync Inc',                            // $10
      dto.state || '',                                               // $11
      dto.country || 'United States',                                // $12
      dto.clientJobId || 'N/A',                                      // $13
      dto.visaType || 'US Citizen / GC',                             // $14
      dto.clientBillRate || 'N/A',                                   // $15
      dto.payRate || 'N/A',                                          // $16
      dto.taxTerms || 'C2C',                                         // $17
      dto.client,                                                    // $18
      dto.endClientName || dto.client,                               // $19
      dto.noOfPositions || 1,                                        // $20
      dto.submissionRequired || 5,                                   // $21
      dto.priority || 'Medium',                                      // $22
      dto.remoteJob || 'No',                                         // $23
      dto.startDate || null,                                         // $24
      dto.endDate || null,                                           // $25
      dto.hoursPerWeek || 40,                                        // $26
      dto.duration || '',                                            // $27
      dto.accountManagerId || null,                                  // $28
      dto.recruitmentManagerId || null,                               // $29
      dto.primaryRecruiterId || null,                                 // $30
      dto.assignedTo || 'N/A',                                       // $31
      dto.industry || '',                                            // $32
      dto.degree || '',                                              // $33
      dto.expMin ?? 0,                                               // $34
      dto.expMax ?? 10,                                              // $35
      createdByEmail || 'System',                                    // $36
      dto.respondBy || null,                                         // $37
      dto.noticePeriod || '',                                        // $38
    ];

    try {
      const result = await this.db.query(sql, params);
      const job = result.rows[0];
      const jobId = job.id;

      // Assign Pod (Explicit or Round-Robin)
      let assignedPodId = dto.podId;
      if (!assignedPodId) {
        // Find next available pod for round-robin
        let podRes = await this.db.query(
          "SELECT id FROM pods WHERE tenant_id = $1 AND is_available_for_assignment = TRUE ORDER BY name ASC LIMIT 1",
          [tenantId]
        );
        if (podRes.rows.length === 0) {
          // Reset cycle
          await this.db.query(
            "UPDATE pods SET is_available_for_assignment = TRUE WHERE tenant_id = $1",
            [tenantId]
          );
          podRes = await this.db.query(
            "SELECT id FROM pods WHERE tenant_id = $1 AND is_available_for_assignment = TRUE ORDER BY name ASC LIMIT 1",
            [tenantId]
          );
        }
        if (podRes.rows.length > 0) {
          assignedPodId = podRes.rows[0].id;
          // Set is_available_for_assignment = FALSE
          await this.db.query(
            "UPDATE pods SET is_available_for_assignment = FALSE WHERE id = $1",
            [assignedPodId]
          );
        }
      }

      if (assignedPodId) {
        // Link job to pod in junction table
        await this.db.query(
          "INSERT INTO job_pods (job_id, pod_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [jobId, assignedPodId]
        );
        // Log assignment
        await this.db.query(
          "INSERT INTO job_assignment_logs (tenant_id, job_id, pod_id, assigned_by) VALUES ($1, $2, $3, $4)",
          [tenantId, jobId, assignedPodId, createdByEmail || 'System']
        );
      }

      return this.findOneJob(jobId, tenantId);
    } catch (err) {
      this.logger.error(`Failed to create job: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Get all jobs for a tenant with user name resolution
   */
  async findAllJobs(tenantId: string): Promise<JobProfile[]> {
    this.logger.log(`Fetching jobs for tenant: ${tenantId}`);

    const sql = `
      SELECT j.*,
             rm.full_name AS recruitment_manager_name,
             pr.full_name AS primary_recruiter_name,
             p.id AS pod_id,
             p.name AS pod_name
      FROM jobs j
      LEFT JOIN users rm ON rm.id = j.recruitment_manager_id
      LEFT JOIN users pr ON pr.id = j.primary_recruiter_id
      LEFT JOIN job_pods jp ON jp.job_id = j.id
      LEFT JOIN pods p ON p.id = jp.pod_id
      WHERE j.tenant_id = $1
      ORDER BY j.created_at DESC
    `;

    try {
      const result = await this.db.query(sql, [tenantId]);
      return result.rows.map((row) => this.mapRowToProfile(row));
    } catch (err) {
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
      ? `SELECT j.*, rm.full_name AS recruitment_manager_name, pr.full_name AS primary_recruiter_name,
                p.id AS pod_id, p.name AS pod_name
         FROM jobs j 
         LEFT JOIN users rm ON rm.id = j.recruitment_manager_id 
         LEFT JOIN users pr ON pr.id = j.primary_recruiter_id
         LEFT JOIN job_pods jp ON jp.job_id = j.id
         LEFT JOIN pods p ON p.id = jp.pod_id
         WHERE j.tenant_id = $1 AND (j.id = $2 OR j.job_code = $2) LIMIT 1`
      : `SELECT j.*, rm.full_name AS recruitment_manager_name, pr.full_name AS primary_recruiter_name,
                p.id AS pod_id, p.name AS pod_name
         FROM jobs j 
         LEFT JOIN users rm ON rm.id = j.recruitment_manager_id 
         LEFT JOIN users pr ON pr.id = j.primary_recruiter_id
         LEFT JOIN job_pods jp ON jp.job_id = j.id
         LEFT JOIN pods p ON p.id = jp.pod_id
         WHERE j.tenant_id = $1 AND j.job_code = $2 LIMIT 1`;

    try {
      const result = await this.db.query(sql, [tenantId, idOrCode]);
      if (result.rows.length === 0) {
        throw new NotFoundException(`Job requisition ${idOrCode} not found.`);
      }
      return this.mapRowToProfile(result.rows[0]);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`findOneJob failed: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Map a raw Postgres row to the typed JobProfile response
   */
  private mapRowToProfile(row: any): JobProfile {
    const createdAt = row.created_at ? new Date(row.created_at) : new Date();
    const agingDays = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      id: row.id,
      jobCode: row.job_code,
      jobTitle: row.job_title,
      businessUnit: row.business_unit || 'enfysync Inc',
      client: row.client_name,
      clientJobId: row.client_job_id || 'N/A',
      location: row.job_location,
      state: row.state || '',
      country: row.country || 'United States',
      type: row.job_type,
      description: row.job_description,
      skillsRequired: row.skills_required || [],
      secondarySkills: row.secondary_skills || [],
      jobStatus: row.status,
      createdOn: createdAt.toISOString().split('T')[0],
      modifiedOn: row.updated_at
        ? new Date(row.updated_at).toISOString().split('T')[0]
        : createdAt.toISOString().split('T')[0],

      visaType: row.visa_type || '',
      clientBillRate: row.client_bill_rate || 'N/A',
      payRate: row.pay_rate || 'N/A',
      taxTerms: row.tax_terms || 'C2C',

      endClientName: row.end_client_name || row.client_name,

      noOfPositions: row.no_of_positions || 1,
      submissionRequired: row.submission_required || 5,
      submissionDone: row.submission_done || 0,
      priority: row.urgency || 'Medium',

      remoteJob: row.remote_job || 'No',
      startDate: row.start_date || null,
      endDate: row.end_date || null,
      hoursPerWeek: row.hours_per_week || 40,
      duration: row.duration || '',

      accountManagerId: row.account_manager_id || '',
      recruitmentManagerId: row.recruitment_manager_id || '',
      recruitmentManager: row.recruitment_manager_name || 'N/A',
      primaryRecruiterId: row.primary_recruiter_id || '',
      primaryRecruiter: row.primary_recruiter_name || 'N/A',
      assignedTo: row.assigned_to || 'N/A',
      createdBy: row.created_by || 'System',

      industry: row.industry || '',
      degree: row.degree || '',
      expMin: row.exp_min ?? 0,
      expMax: row.exp_max ?? 10,

      // Computed fields
      submissionsCount: row.submission_done || 0,
      agingDays,
      pipeline: { applied: 0, interviewing: 0, offered: 0 }, // TODO: aggregate from submissions table
      podId: row.pod_id || '',
      podName: row.pod_name || '',
      respondBy: row.respond_by ? new Date(row.respond_by).toISOString().split('T')[0] : null,
      noticePeriod: row.notice_period || '',
    };
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
    const jobRes = await this.db.query(
      "SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [id, tenantId]
    );
    if (jobRes.rows.length === 0) {
      throw new NotFoundException(`Job not found.`);
    }

    // If updating primary_recruiter_id, apply validation rules
    if (dto.primaryRecruiterId !== undefined) {
      const newRecruiterId = dto.primaryRecruiterId;

      // Fetch user permissions & roles
      const userPermissions = user.permissions || [];
      const userSystemRole = user.systemRole || 'RECRUITER';
      const isSuperAdmin = user.roles && user.roles.includes('SUPER_ADMIN');

      // Check if user has pod:edit (Delivery Head / Admin) or is Super Admin
      const hasOverridePermission = userPermissions.includes('pod:edit') || isSuperAdmin;

      if (hasOverridePermission) {
        // Delivery Head / Admin can assign ANY recruiter in the tenant
        if (newRecruiterId) {
          const recruiterRes = await this.db.query(
            "SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
            [newRecruiterId, tenantId]
          );
          if (recruiterRes.rows.length === 0) {
            throw new NotFoundException("Selected recruiter does not exist in this tenant.");
          }
        }
      } else if (userSystemRole === 'POD_LEAD' || userPermissions.includes('job:edit')) {
        // Pod Head (POD_LEAD) can only assign recruiters from within their own pod
        const userPodRes = await this.db.query(
          "SELECT pod_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
          [user.dbId, tenantId]
        );
        const userPodId = userPodRes.rows[0]?.pod_id;
        if (!userPodId) {
          throw new BadRequestException("You are designated as a Pod Head but you are not assigned to any pod.");
        }

        // Verify if this job is assigned to the user's pod
        const jobPodRes = await this.db.query(
          "SELECT 1 FROM job_pods WHERE job_id = $1 AND pod_id = $2 LIMIT 1",
          [id, userPodId]
        );
        if (jobPodRes.rows.length === 0) {
          throw new BadRequestException("You can only assign recruiters to jobs mapped to your pod.");
        }

        // Verify if the selected recruiter belongs to the user's pod
        if (newRecruiterId) {
          const recruiterPodRes = await this.db.query(
            "SELECT pod_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
            [newRecruiterId, tenantId]
          );
          if (recruiterPodRes.rows.length === 0 || recruiterPodRes.rows[0].pod_id !== userPodId) {
            throw new BadRequestException("You can only assign recruiters belonging to your own pod.");
          }
        }
      } else {
        throw new BadRequestException("You do not have permission to assign recruiters to this job.");
      }
    }

    // Prepare fields to update dynamically
    const fields: string[] = [];
    const params: any[] = [id, tenantId];
    let paramIndex = 3;

    const addField = (dbCol: string, val: any) => {
      if (val !== undefined) {
        fields.push(`${dbCol} = $${paramIndex}`);
        params.push(val);
        paramIndex++;
      }
    };

    addField('job_title', dto.title);
    addField('job_location', dto.location);
    addField('job_type', dto.type);
    addField('job_description', dto.description);
    addField('skills_required', dto.skillsRequired);
    addField('secondary_skills', dto.secondarySkills);
    addField('status', dto.status);
    addField('business_unit', dto.businessUnit);
    addField('state', dto.state);
    addField('country', dto.country);
    addField('client_job_id', dto.clientJobId);
    addField('visa_type', dto.visaType);
    addField('client_bill_rate', dto.clientBillRate);
    addField('pay_rate', dto.payRate);
    addField('tax_terms', dto.taxTerms);
    addField('client_name', dto.client);
    addField('end_client_name', dto.endClientName);
    addField('no_of_positions', dto.noOfPositions);
    addField('submission_required', dto.submissionRequired);
    addField('urgency', dto.priority);
    addField('remote_job', dto.remoteJob);
    addField('start_date', dto.startDate);
    addField('end_date', dto.endDate);
    addField('hours_per_week', dto.hoursPerWeek);
    addField('duration', dto.duration);
    addField('account_manager_id', dto.accountManagerId);
    addField('recruitment_manager_id', dto.recruitmentManagerId);
    addField('primary_recruiter_id', dto.primaryRecruiterId);
    addField('assigned_to', dto.assignedTo);
    addField('industry', dto.industry);
    addField('degree', dto.degree);
    addField('exp_min', dto.expMin);
    addField('exp_max', dto.expMax);
    addField('respond_by', dto.respondBy);
    addField('notice_period', dto.noticePeriod);

    if (fields.length > 0) {
      const updateSql = `
        UPDATE jobs
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `;
      await this.db.query(updateSql, params);
    }

    // If updating pod assignment (e.g. for Admins/Delivery Heads re-routing jobs)
    if (dto.podId !== undefined) {
      const userPermissions = user?.permissions || [];
      const isSuperAdmin = user?.roles && user.roles.includes('SUPER_ADMIN');
      const hasOverridePermission = userPermissions.includes('pod:edit') || isSuperAdmin;

      if (!hasOverridePermission) {
        throw new ForbiddenException('You do not have permission to modify job pod assignments.');
      }

      await this.db.query("DELETE FROM job_pods WHERE job_id = $1", [id]);
      if (dto.podId) {
        await this.db.query(
          "INSERT INTO job_pods (job_id, pod_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [id, dto.podId]
        );
        await this.db.query(
          "INSERT INTO job_assignment_logs (tenant_id, job_id, pod_id, assigned_by) VALUES ($1, $2, $3, $4)",
          [tenantId, id, dto.podId, user?.email || 'System']
        );
      }
    }

    return this.findOneJob(id, tenantId);
  }

  // ─────────────────────────────────────────────────────────────
  //  AI CANDIDATE MATCHING
  //  Ranks candidates in the tenant's pool against a job requisition.
  //  Runs entirely off the shared Supabase DB (skill overlap + experience
  //  fit + resume-text keyword hits) and, when the Python parser is
  //  reachable, blends in pgvector semantic similarity.
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

    // Pull the tenant's candidate pool with parsed skills + raw resume text.
    const candRes = await this.db.query(
      `SELECT c.id, c.full_name, c.email, c.phone, c.raw_current_location,
              c.raw_current_designation, c.source, c.work_authorization,
              c.total_experience_years, r.raw_text, r.parsed_json
       FROM candidates c
       LEFT JOIN resumes r ON c.resume_record_id = r.id
       WHERE c.tenant_id = $1`,
      [tenantId],
    );

    // Optional semantic layer: ask the parser to rank the pool by the job's
    // title + skills. Best-effort — skipped silently if the parser is offline.
    const semanticByEmail = await this.fetchSemanticScores(job);
    const parserOnline = semanticByEmail !== null;

    const matches: CandidateMatch[] = candRes.rows.map((row: any) => {
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

      // Experience fit: full credit inside [expMin, expMax]; scaled below min; no penalty above max.
      const years = Number(row.total_experience_years) || 0;
      let expFit = 1;
      if (job.expMin && years < job.expMin) expFit = job.expMin > 0 ? years / job.expMin : 0;
      const expScore = Math.max(0, Math.min(1, expFit));

      // Weighting: primary skills dominate; secondary and experience refine.
      // If a job has no secondary skills, that weight folds into primary.
      const hasSecondary = secondarySkills.length > 0;
      const wPrimary = hasSecondary ? 0.7 : 0.85;
      const wSecondary = hasSecondary ? 0.15 : 0;
      const wExp = 0.15;
      let score01 = wPrimary * primaryRatio + wSecondary * secondaryRatio + wExp * expScore;

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
      `Matched ${ranked.length}/${candRes.rows.length} candidates for job ${job.jobCode} (parser ${parserOnline ? 'online' : 'offline'}).`,
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
        const timer = setTimeout(() => controller.abort(), 2500);
        const url = `${host}/api/v1/search?query=${encodeURIComponent(query)}&top_k=100&threshold=0`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
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
      } catch {
        // try next host
      }
    }
    return null; // parser offline — matching proceeds without semantic blend
  }
}
