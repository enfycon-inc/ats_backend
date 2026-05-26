import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';

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
  createdAt: string;
  updatedAt: string;
  
  // Joined fields
  candidateName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateCurrentLocation?: string;
  jobCode?: string;
  jobTitle?: string;
  clientName?: string;
  endClientName?: string;
}

@Injectable()
export class RecruiterSubmissionsService {
  private readonly logger = new Logger(RecruiterSubmissionsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Create a new recruiter submission
   */
  async create(dto: CreateSubmissionDto, tenantId: string): Promise<SubmissionDetails> {
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

    if (job.status !== 'ACTIVE') {
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
    }

    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');

      // 4. Insert submission
      const sql = `
        INSERT INTO recruiter_submissions (
          tenant_id, job_id, candidate_id, recruiter_id,
          l1_status, l1_date, l2_status, l2_date, l3_status, l3_date,
          final_status, remarks, recruiter_comment, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
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
    }
  ) {
    this.logger.log(`Listing submissions for tenant: ${tenantId}`);

    let baseSql = `
      SELECT 
        s.*,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.raw_current_location AS candidate_current_location,
        j.job_code,
        j.job_title,
        j.client_name,
        j.end_client_name
      FROM recruiter_submissions s
      LEFT JOIN candidates c ON s.candidate_id = c.id
      LEFT JOIN jobs j ON s.job_id = j.id
      WHERE s.tenant_id = $1
    `;

    const params: any[] = [tenantId];
    let paramIndex = 2;

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

    if (filters.startDate) {
      baseSql += ` AND s.created_at >= $${paramIndex}`;
      params.push(new Date(filters.startDate));
      paramIndex++;
    }

    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      baseSql += ` AND s.created_at <= $${paramIndex}`;
      params.push(end);
      paramIndex++;
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
   * Fetch single recruiter submission detail, scoped by tenant
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
        j.job_code,
        j.job_title,
        j.client_name,
        j.end_client_name
      FROM recruiter_submissions s
      LEFT JOIN candidates c ON s.candidate_id = c.id
      LEFT JOIN jobs j ON s.job_id = j.id
      WHERE s.id = $1 AND s.tenant_id = $2 LIMIT 1
    `;

    const result = await this.db.query(sql, [id, tenantId]);
    if (result.rows.length === 0) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    return this.mapRowToDetails(result.rows[0]);
  }

  /**
   * Update submission statuses with auto-rejection logic
   */
  async update(id: number, dto: UpdateSubmissionDto, tenantId: string): Promise<SubmissionDetails> {
    this.logger.log(`Updating submission ID=${id} for tenant: ${tenantId}`);

    // Retrieve existing submission
    const existingResult = await this.db.query(
      'SELECT * FROM recruiter_submissions WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    const existing = existingResult.rows[0];

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
  async getTrackerStats(tenantId: string) {
    this.logger.log(`Retrieving aggregate tracker stats for tenant: ${tenantId}`);

    const totalSql = 'SELECT COUNT(*) FROM recruiter_submissions WHERE tenant_id = $1';
    const l1Sql = "SELECT COUNT(*) FROM recruiter_submissions WHERE tenant_id = $1 AND l1_status = 'PENDING'";
    const l2Sql = "SELECT COUNT(*) FROM recruiter_submissions WHERE tenant_id = $1 AND l2_status = 'PENDING'";
    const l3Sql = "SELECT COUNT(*) FROM recruiter_submissions WHERE tenant_id = $1 AND l3_status = 'PENDING'";

    try {
      const [totalRes, l1Res, l2Res, l3Res] = await Promise.all([
        this.db.query(totalSql, [tenantId]),
        this.db.query(l1Sql, [tenantId]),
        this.db.query(l2Sql, [tenantId]),
        this.db.query(l3Sql, [tenantId]),
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
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      candidatePhone: row.candidate_phone,
      candidateCurrentLocation: row.candidate_current_location,
      jobCode: row.job_code,
      jobTitle: row.job_title,
      clientName: row.client_name,
      endClientName: row.end_client_name,
    };
  }
}
