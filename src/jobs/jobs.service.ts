import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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
    ];

    try {
      const result = await this.db.query(sql, params);
      return this.mapRowToProfile(result.rows[0]);
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
             pr.full_name AS primary_recruiter_name
      FROM jobs j
      LEFT JOIN users rm ON rm.id = j.recruitment_manager_id
      LEFT JOIN users pr ON pr.id = j.primary_recruiter_id
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
      ? `SELECT j.*, rm.full_name AS recruitment_manager_name, pr.full_name AS primary_recruiter_name
         FROM jobs j LEFT JOIN users rm ON rm.id = j.recruitment_manager_id LEFT JOIN users pr ON pr.id = j.primary_recruiter_id
         WHERE j.tenant_id = $1 AND (j.id = $2 OR j.job_code = $2) LIMIT 1`
      : `SELECT j.*, rm.full_name AS recruitment_manager_name, pr.full_name AS primary_recruiter_name
         FROM jobs j LEFT JOIN users rm ON rm.id = j.recruitment_manager_id LEFT JOIN users pr ON pr.id = j.primary_recruiter_id
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
    };
  }
}
