import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CreateCandidateDto } from './dtos/create-candidate.dto';
import { CandidateQueryDto } from './dtos/candidate-query.dto';
import { CandidateProfile, CandidateDbRow } from './interfaces/candidate.interface';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

/** The original CV file bytes plus metadata, for download/preview. */
export interface StoredResumeFile {
  data: Buffer;
  mime: string;
  filename: string;
}

@Injectable()
export class CandidatesService implements OnModuleInit {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.ensureResumeFileColumns();
  }

  /**
   * The `resumes` table (owned by the Python parser) stores parsed text/JSON but
   * not the original file. Add columns so the ATS can persist and serve the CV.
   */
  private async ensureResumeFileColumns() {
    const stmts = [
      `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_data BYTEA`,
      `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_mime VARCHAR(150)`,
      `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_size INT`,
    ];
    for (const s of stmts) {
      try { await this.db.query(s); } catch (err: any) {
        this.logger.debug(`Resume file-column migration note: ${err.message}`);
      }
    }
    this.logger.log('Resume file-storage columns verified (file_data, file_mime, file_size).');
  }

  /**
   * Safe SQL transaction to create a candidate and link their resume record in one step
   */
  async createCandidate(dto: CreateCandidateDto, tenantId: string, user?: AuthUser): Promise<CandidateProfile> {
    this.logger.log(`Creating database records for candidate: ${dto.fullName} (${dto.email}) for tenant: ${tenantId}`);
    
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');

      const resumeJson = {
        candidate_name: dto.fullName,
        contact: {
          emails: [dto.email],
          phones: [dto.phone],
        },
        skills: dto.skills || [],
        work_authorization: dto.workAuthorization,
        experience_years: dto.experienceYears,
      };

      // 1. Insert into resumes table
      const resumeResult = await client.query(
        `INSERT INTO resumes (filename, candidate_name, email, file_hash, parsed_json, raw_text, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id`,
        [
          `${dto.source.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}.html`,
          dto.fullName,
          dto.email,
          `external-${dto.source.toLowerCase()}-${Math.floor(100000 + Math.random() * 900000)}`,
          JSON.stringify(resumeJson),
          dto.rawText,
        ]
      );
      const resumeRecordId = resumeResult.rows[0].id;

      // 2. Insert into candidates table with tenant_id, uploader info, and candidate_code
      const candidateResult = await client.query(
        `INSERT INTO candidates (full_name, email, phone, raw_current_location, total_experience_years, raw_current_designation, created_at, source, work_authorization, resume_record_id, tenant_id, uploaded_by_user_id, uploaded_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12)
         RETURNING id, created_at`,
        [
          dto.fullName,
          dto.email,
          dto.phone,
          dto.location,
          dto.experienceYears,
          dto.jobTitle,
          dto.source,
          dto.workAuthorization,
          resumeRecordId,
          tenantId,
          user?.dbId || null,
          user?.fullName || user?.email || 'System Upload',
        ]
      );
      
      const candidateId = candidateResult.rows[0].id;
      const createdAt = candidateResult.rows[0].created_at;
      const candidateCode = `CAN-${String(candidateId).padStart(6, '0')}`;
      await client.query('UPDATE candidates SET candidate_code = $1 WHERE id = $2', [candidateCode, candidateId]);

      await client.query('COMMIT');

      const locationParts = dto.location.split(/,\s*/);
      const city = locationParts[0] || 'Unknown';
      const state = locationParts[1] || 'Unknown';

      return {
        id: `INT-${dto.source.toUpperCase()}-${candidateId}`,
        applicantId: `APP-${candidateId}`,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        city,
        state,
        source: dto.source,
        status: 'New lead',
        jobTitle: dto.jobTitle,
        skills: dto.skills || [],
        workAuthorization: dto.workAuthorization,
        experienceYears: dto.experienceYears,
        rawText: dto.rawText,
        createdOn: new Date(createdAt).toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to execute candidate creation transaction: ${err.message}`, err.stack);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetches and maps candidates using filters, dynamic keywords, and limits, scoped by tenant
   */
  async findAll(query: CandidateQueryDto, tenantId: string, user?: AuthUser): Promise<CandidateProfile[]> {
    this.logger.log(`Fetching candidates from Supabase DB for tenant: ${tenantId}. Filters q="${query.q || 'None'}", market="${query.market || 'Auto'}"`);
    
    // Fetch tenant candidate pool access mode (default 'COMBINED_MARKET')
    let poolMode = 'COMBINED_MARKET';
    try {
      const tenantRes = await this.db.query('SELECT candidate_pool_mode FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
      if (tenantRes.rows.length > 0 && tenantRes.rows[0].candidate_pool_mode) {
        poolMode = tenantRes.rows[0].candidate_pool_mode;
      }
    } catch (err: any) {
      this.logger.debug(`Could not read tenant candidate_pool_mode: ${err.message}`);
    }

    let baseSql = `
      SELECT c.*, r.raw_text, r.parsed_json
      FROM candidates c
      LEFT JOIN resumes r ON c.resume_record_id = r.id
      WHERE c.tenant_id = $1
    `;
    const params: any[] = [tenantId];
    let paramIndex = 2;

    const canSearchAll = user?.permissions?.includes('candidate:search_all_markets') || user?.roles?.includes('ADMIN') || user?.roles?.includes('SUPER_ADMIN');

    // 1. Market Scoping Logic:
    // - If query.allMarkets is true or query.market is not specified, bypass market filter to show all tenant candidates.
    // - If query.market is explicitly passed (e.g. 'US' or 'INDIA'), filter by that market.
    if (query.market && !query.allMarkets) {
      const effectiveMarket = query.market.toUpperCase();
      baseSql += ` AND (UPPER(c.market) = $${paramIndex} OR (c.market IS NULL AND $${paramIndex} = 'US'))`;
      params.push(effectiveMarket);
      paramIndex++;
    }

    // 2. Branch Scoping Logic:
    // - Explicit query.branchId always filters by that branch.
    // - In 'STRICT_BRANCH' mode: Non-admin recruiters only see candidates assigned to their home branch.
    // - In 'COMBINED_MARKET' mode (DEFAULT): Candidates are combined across all branches within the market.
    // - In 'ALL_BRANCHES' mode: Candidates are accessible workspace-wide.
    const canSearchAllBranches = user?.permissions?.includes('candidate:search_all_branches') || user?.roles?.includes('ADMIN') || user?.roles?.includes('SUPER_ADMIN');

    if (query.branchId && !query.allBranches) {
      baseSql += ` AND (c.branch_id = $${paramIndex} OR c.branch_id IS NULL)`;
      params.push(query.branchId);
      paramIndex++;
    } else if (poolMode === 'STRICT_BRANCH' && user?.branchId && !canSearchAllBranches && !query.allBranches) {
      baseSql += ` AND (c.branch_id = $${paramIndex} OR c.branch_id IS NULL)`;
      params.push(user.branchId);
      paramIndex++;
    }

    if (query.source) {
      baseSql += ` AND c.source = $${paramIndex}`;
      params.push(query.source);
      paramIndex++;
    }

    if (query.q && query.q !== '*') {
      const lowerQ = `%${query.q.toLowerCase()}%`;
      baseSql += ` AND (LOWER(c.full_name) LIKE $${paramIndex} OR LOWER(c.raw_current_designation) LIKE $${paramIndex} OR LOWER(r.raw_text) LIKE $${paramIndex})`;
      params.push(lowerQ);
      paramIndex++;
    }

    baseSql += ' ORDER BY c.created_at DESC';

    const limit = query.limit || 5000;
    baseSql += ` LIMIT $${paramIndex}`;
    params.push(limit);
    paramIndex++;

    if (query.offset) {
      baseSql += ` OFFSET $${paramIndex}`;
      params.push(query.offset);
    }

    try {
      const result = await this.db.query(baseSql, params);

      return result.rows.map((row: any) => this.mapRowToProfile(row));
    } catch (err) {
      this.logger.error(`Failed to fetch candidates: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Retrieves a single candidate with joined resumes details, scoped by tenant
   */
  async findOne(id: number, tenantId: string): Promise<CandidateProfile> {
    this.logger.log(`Fetching candidate detail for ID=${id} and tenant=${tenantId}`);

    const result = await this.db.query(
      `SELECT c.*, r.raw_text, r.parsed_json
       FROM candidates c
       LEFT JOIN resumes r ON c.resume_record_id = r.id
       WHERE c.id = $1 AND c.tenant_id = $2 LIMIT 1`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found.`);
    }

    return this.mapRowToProfile(result.rows[0]);
  }

  /**
   * Finds a candidate by their email address for de-duplication checks, scoped by tenant
   */
  async findByEmail(email: string, tenantId: string): Promise<CandidateProfile | null> {
    const result = await this.db.query(
      `SELECT c.*, r.raw_text, r.parsed_json
       FROM candidates c
       LEFT JOIN resumes r ON c.resume_record_id = r.id
       WHERE c.email = $1 AND c.tenant_id = $2 LIMIT 1`,
      [email, tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToProfile(result.rows[0]);
  }

  /**
   * Deletes a candidate by ID, scoped by tenant
   */
  async deleteCandidate(id: number, tenantId: string): Promise<{ message: string }> {
    this.logger.log(`Initiating deletion for Candidate ID=${id} for tenant: ${tenantId}`);
    
    const candidate = await this.db.query('SELECT resume_record_id FROM candidates WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (candidate.rows.length === 0) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found.`);
    }

    const resumeRecordId = candidate.rows[0].resume_record_id;
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');
      
      // Delete candidate experience, education, skills if present
      await client.query('DELETE FROM candidate_experience WHERE candidate_id = $1', [id]);
      await client.query('DELETE FROM candidate_education WHERE candidate_id = $1', [id]);
      await client.query('DELETE FROM candidate_skills WHERE candidate_id = $1', [id]);
      
      // Delete from candidates
      await client.query('DELETE FROM candidates WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      
      // Delete from resumes
      if (resumeRecordId) {
        await client.query('DELETE FROM resumes WHERE id = $1', [resumeRecordId]);
      }

      await client.query('COMMIT');
      return { message: `Candidate with ID ${id} and linked resume were successfully deleted.` };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to delete candidate ID=${id}: ${err.message}`, err.stack);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Utility method to map raw database query rows to typed candidate profile payloads
   */
  private mapRowToProfile(row: any): CandidateProfile {
    const locationParts = (row.raw_current_location || '').split(/,\s*/);
    const city = locationParts[0] || 'Unknown';
    const state = locationParts[1] || 'Unknown';

    let skills: string[] = [];
    let parsedJsonObj: any = null;
    if (row.parsed_json) {
      parsedJsonObj = typeof row.parsed_json === 'string' ? JSON.parse(row.parsed_json) : row.parsed_json;
      skills = parsedJsonObj.skills || [];
    }

    const candidateCode = row.candidate_code || `CAN-${String(row.id).padStart(6, '0')}`;
    const uploadedByName = row.uploaded_by_name || (row.source === 'Bulk Upload Benchmark' ? 'System Benchmark' : 'System');

    return {
      id: `INT-${row.source ? row.source.toUpperCase() : 'DB'}-${row.id}`,
      dbId: row.id,
      candidateCode,
      uploadedByUserId: row.uploaded_by_user_id || null,
      uploadedByName,
      applicantId: `APP-${row.id}`,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      city,
      state,
      source: row.source || 'Direct Upload',
      status: 'New lead',
      jobTitle: row.raw_current_designation || 'Unknown',
      skills,
      workAuthorization: row.work_authorization || 'US Authorized',
      experienceYears: row.total_experience_years || 0,
      rawText: row.raw_text || '',
      createdOn: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      currentCTC: row.current_ctc ? Number(row.current_ctc) : null,
      expectedCTC: row.expected_ctc ? Number(row.expected_ctc) : null,
      noticePeriodDays: row.notice_period_days ? Number(row.notice_period_days) : 0,
      servingNotice: !!row.serving_notice,
      lastWorkingDay: row.last_working_day || null,
      panCard: row.pan_card || null,
      preferredLocations: row.preferred_locations || [],
      parsedJson: parsedJsonObj,
    };
  }

  /**
   * Find an existing candidate by resume file hash (de-duplication), scoped by tenant.
   */
  async findByHash(fileHash: string, tenantId: string): Promise<CandidateProfile | null> {
    const result = await this.db.query(
      `SELECT c.*, r.raw_text, r.parsed_json
       FROM candidates c
       JOIN resumes r ON c.resume_record_id = r.id
       WHERE r.file_hash = $1 AND c.tenant_id = $2 LIMIT 1`,
      [fileHash, tenantId],
    );
    return result.rows.length ? this.mapRowToProfile(result.rows[0]) : null;
  }

  /**
/**
   * CV SAVE MECHANISM — upload a resume file, parse it (best-effort via the Python
   * parser), and persist the original file + structured candidate in one transaction.
   *
   *  1. Hash the bytes and de-duplicate (same CV already imported → return it).
   *  2. Ask the FastAPI parser to extract structured fields. If it's offline, fall
   *     back to filename-derived defaults so the upload never fails.
   *  3. Store the file bytes, parsed JSON, and raw text in `resumes`, then create
   *     the linked `candidates` row.
   */
  async saveUploadedCv(
    file: { originalname: string; mimetype: string; buffer: Buffer; size?: number },
    tenantId: string,
    meta: { source?: string; fullName?: string; email?: string; phone?: string; branchId?: string; market?: string } = {},
    user?: AuthUser,
  ): Promise<{ candidate: CandidateProfile; duplicate: boolean; parsed: boolean; updated?: boolean }> {
    if (!file?.buffer) throw new NotFoundException('No file uploaded.');

    const uploaderId = user?.dbId || null;
    const uploaderName = user?.fullName || user?.email || (meta.source === 'Bulk Upload Benchmark' ? 'System Benchmark' : 'System');

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 1. De-duplicate on exact file hash.
    const existing = await this.findByHash(fileHash, tenantId);
    if (existing) {
      this.logger.log(`CV already imported (hash ${fileHash.slice(0, 12)}…) → returning existing candidate.`);
      return { candidate: existing, duplicate: true, parsed: false };
    }

    // 2. Best-effort parse via the Python service.
    let parsed: any = null;
    try {
      parsed = await this.parseResumeFile(file);
    } catch (err: any) {
      this.logger.warn(`Parser unavailable, saving CV with basic metadata only: ${err.message}`);
    }

    const contact = parsed?.contact || {};
    const fallbackName = file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const fullName = meta.fullName || parsed?.candidate_name || fallbackName || 'Unnamed Candidate';
    const email = meta.email || (contact.emails && contact.emails[0]) || `no-email-${fileHash.slice(0, 8)}@import.local`;
    const phone = meta.phone || (contact.phones && contact.phones[0]) || '';
    const skills: string[] = parsed?.skills || [];
    const workAuth = parsed?.work_authorization || 'Unknown';
    const location = parsed?.ats_normalized?.location?.[0]?.raw || parsed?.location || '';
    const designation = parsed?.experience?.detected_roles?.[0] || parsed?.ats_normalized?.designations?.[0]?.raw || '';
    const expYears = parsed?.experience_years
      ?? parsed?.experience_detailed?.length
      ?? 0;
    const rawText = parsed?.raw_text || parsed?.word_count ? (parsed?.raw_text || '') : '';

    // 3. De-duplicate on Email (Option A - Update profile if email exists)
    const isRealEmail = email && !email.includes('@import.local');
    if (isRealEmail) {
      const emailCheck = await this.db.query(
        'SELECT id FROM candidates WHERE email = $1 AND tenant_id = $2 LIMIT 1',
        [email, tenantId]
      );
      if (emailCheck.rows.length > 0) {
        const existingCandId = emailCheck.rows[0].id;
        this.logger.log(`Candidate with email ${email} already exists (ID=${existingCandId}). Updating profile with new CV.`);

        const client = await this.db.getClient();
        try {
          await client.query('BEGIN');

          // Insert new resume record
          const resumeRes = await client.query(
            `INSERT INTO resumes 
              (filename, candidate_name, email, file_hash, parsed_json, raw_text, file_data, file_mime, file_size, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             RETURNING id`,
            [
              file.originalname,
              fullName,
              email,
              fileHash,
              JSON.stringify(parsed || { candidate_name: fullName, skills }),
              rawText,
              file.buffer,
              file.mimetype || 'application/octet-stream',
              file.size ?? file.buffer.length,
            ],
          );
          const newResumeId = resumeRes.rows[0].id;

          // Update candidate with new resume ID and details
          await client.query(
            `UPDATE candidates 
             SET full_name = $1, phone = $2, raw_current_location = $3, total_experience_years = $4,
                 raw_current_designation = $5, work_authorization = $6, resume_record_id = $7, 
                 uploaded_by_user_id = COALESCE(uploaded_by_user_id, $8),
                 uploaded_by_name = COALESCE(uploaded_by_name, $9),
                 updated_at = NOW()
             WHERE id = $10 AND tenant_id = $11`,
            [fullName, phone, location, expYears, designation, workAuth, newResumeId, uploaderId, uploaderName, existingCandId, tenantId]
          );

          await client.query('COMMIT');

          const updatedCandidate = await this.findOne(existingCandId, tenantId);
          return { candidate: updatedCandidate, duplicate: true, updated: true, parsed: true };
        } catch (err: any) {
          await client.query('ROLLBACK');
          this.logger.error(`Failed to update candidate on duplicate email: ${err.message}`, err.stack);
          throw err;
        } finally {
          client.release();
        }
      }
    }

    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');

      const resumeRes = await client.query(
        `INSERT INTO resumes 
          (filename, candidate_name, email, file_hash, parsed_json, raw_text, file_data, file_mime, file_size, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id`,
        [
          file.originalname,
          fullName,
          email,
          fileHash,
          JSON.stringify(parsed || { candidate_name: fullName, skills }),
          rawText,
          file.buffer,
          file.mimetype || 'application/octet-stream',
          file.size ?? file.buffer.length,
        ],
      );
      const resumeId = resumeRes.rows[0].id;

      const candRes = await client.query(
        `INSERT INTO candidates
          (full_name, email, phone, raw_current_location, total_experience_years,
           raw_current_designation, created_at, source, work_authorization, resume_record_id, tenant_id, branch_id, market, uploaded_by_user_id, uploaded_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, created_at`,
        [fullName, email, phone, location, expYears, designation,
         meta.source || 'CV Upload', workAuth, resumeId, tenantId, meta.branchId || null, meta.market || 'US', uploaderId, uploaderName],
      );

      const candidateId = candRes.rows[0].id;
      const candidateCode = `CAN-${String(candidateId).padStart(6, '0')}`;
      await client.query('UPDATE candidates SET candidate_code = $1 WHERE id = $2', [candidateCode, candidateId]);

      await client.query('COMMIT');

      const createdCandidate = await this.findOne(candidateId, tenantId);
      this.logger.log(`Saved CV for "${fullName}" (${candidateCode}, ID=${candidateId}, uploadedBy=${uploaderName}, parsed=${!!parsed}).`);
      return { candidate: createdCandidate, duplicate: false, parsed: !!parsed };
    } catch (err: any) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to save uploaded CV: ${err.message}`, err.stack);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve the original stored CV file for a candidate (for download/preview).
   */
  async getResumeFile(candidateId: number, tenantId: string): Promise<StoredResumeFile> {
    const result = await this.db.query(
      `SELECT r.file_data, r.file_mime, r.filename
       FROM candidates c
       JOIN resumes r ON c.resume_record_id = r.id
       WHERE c.id = $1 AND c.tenant_id = $2 LIMIT 1`,
      [candidateId, tenantId],
    );
    if (!result.rows.length || !result.rows[0].file_data) {
      throw new NotFoundException(`No stored CV file for candidate ${candidateId}.`);
    }
    const row = result.rows[0];
    return {
      data: row.file_data as Buffer,
      mime: row.file_mime || 'application/octet-stream',
      filename: row.filename || `candidate-${candidateId}-cv`,
    };
  }

  /**
   * Uploads a manual CV file to FastAPI and polls the task status
   */
  async parseResumeFile(file: any): Promise<any> {
    this.logger.log(`[FILE PARSER] Forwarding file ${file.originalname} to FastAPI extractor`);

    const formData = new FormData();
    const blob = new Blob([file.buffer], { type: file.mimetype });
    formData.append('file', blob, file.originalname);

    let apiHost = 'http://api:8000';
    let response;

    try {
      this.logger.log(`[FILE PARSER] Connecting to FastAPI extractor at ${apiHost}...`);
      response = await fetch(`${apiHost}/api/v1/extract`, {
        method: 'POST',
        body: formData,
      });
    } catch (err: any) {
      this.logger.warn(`Could not connect to ${apiHost}, attempting local http://localhost:8000: ${err.message}`);
      apiHost = 'http://localhost:8000';
      try {
        response = await fetch(`${apiHost}/api/v1/extract`, {
          method: 'POST',
          body: formData,
        });
      } catch (innerErr: any) {
        this.logger.error(`Failed to reach resume parser on all endpoints: ${innerErr.message}`);
        throw new Error('Resume parser service is offline.');
      }
    }

    if (response && response.ok) {
      try {
        const resultData = await response.json();
        this.logger.log(`[FILE PARSER] Parser response: ${JSON.stringify(resultData)}`);

        if (resultData.status === 'completed') {
          return resultData.data;
        } else if (resultData.status === 'accepted') {
          const taskId = resultData.task_id;
          this.logger.log(`[FILE PARSER] Celery task scheduled with ID=${taskId}. Starting status poll...`);

          // Poll loop: 500ms intervals for up to 15 seconds (30 iterations)
          for (let attempt = 1; attempt <= 30; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const statusRes = await fetch(`${apiHost}/api/v1/status/${taskId}`);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                this.logger.log(`[Poll Attempt ${attempt}] Task status: ${statusData.status}`);
                if (statusData.status === 'SUCCESS' || statusData.status === 'completed') {
                  return statusData.result?.data || statusData.result;
                } else if (statusData.status === 'FAILURE') {
                  this.logger.error(`Celery task reported FAILURE for taskId=${taskId}`);
                  throw new Error('Celery worker failed to process resume.');
                }
              }
            } catch (pollErr: any) {
              this.logger.warn(`Polling status attempt ${attempt} encountered error: ${pollErr.message}`);
            }
          }
          throw new Error('Resume parser task timed out.');
        }
      } catch (jsonErr: any) {
        this.logger.error(`Error parsing response payload: ${jsonErr.message}`);
        throw jsonErr;
      }
    } else {
      throw new Error(`Failed to upload file to parser: ${response?.statusText || 'Unknown error'}`);
    }
  }

  /**
   * Fetch all pending normalizations from database
   */
  async getPendingNormalizations(): Promise<any[]> {
    this.logger.log(`Fetching pending normalizations queue`);
    const result = await this.db.query(
      `SELECT id, category, raw_value AS "rawValue", detected_count AS "detectedCount", created_at AS "createdAt"
       FROM pending_normalizations
       ORDER BY detected_count DESC, created_at DESC`
    );
    return result.rows;
  }

  /**
   * Approve a pending normalization term either as canonical or alias
   */
  async approveNormalization(body: {
    category: string;
    rawValue: string;
    action: 'canonical' | 'alias';
    canonicalId?: number;
    country?: string;
    state?: string;
    seniorityLevel?: string;
  }): Promise<any> {
    const { category, rawValue, action, canonicalId, country, state, seniorityLevel } = body;
    this.logger.log(`Approving normalization: rawValue="${rawValue}", category="${category}", action="${action}"`);

    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');

      const upperCategory = category.toUpperCase();
      let masterId = canonicalId;

      if (action === 'canonical') {
        if (upperCategory === 'SKILL') {
          const existing = await client.query(`SELECT id FROM skills_master WHERE LOWER(canonical_name) = LOWER($1) LIMIT 1`, [rawValue]);
          if (existing.rows.length > 0) {
            masterId = existing.rows[0].id;
          } else {
            const insertRes = await client.query(
              `INSERT INTO skills_master (canonical_name, category_id) VALUES ($1, 1) RETURNING id`,
              [rawValue]
            );
            masterId = insertRes.rows[0].id;
          }
        } else if (upperCategory === 'DESIGNATION') {
          const existing = await client.query(`SELECT id FROM designations_master WHERE LOWER(canonical_designation) = LOWER($1) LIMIT 1`, [rawValue]);
          if (existing.rows.length > 0) {
            masterId = existing.rows[0].id;
          } else {
            const insertRes = await client.query(
              `INSERT INTO designations_master (canonical_designation, seniority_level) VALUES ($1, $2) RETURNING id`,
              [rawValue, seniorityLevel || 'Mid']
            );
            masterId = insertRes.rows[0].id;
          }
        } else if (upperCategory === 'COMPANY') {
          const existing = await client.query(`SELECT id FROM companies_master WHERE LOWER(canonical_company_name) = LOWER($1) LIMIT 1`, [rawValue]);
          if (existing.rows.length > 0) {
            masterId = existing.rows[0].id;
          } else {
            const insertRes = await client.query(
              `INSERT INTO companies_master (canonical_company_name) VALUES ($1) RETURNING id`,
              [rawValue]
            );
            masterId = insertRes.rows[0].id;
          }
        } else if (upperCategory === 'LOCATION') {
          const existing = await client.query(`SELECT id FROM locations_master WHERE LOWER(canonical_location) = LOWER($1) LIMIT 1`, [rawValue]);
          if (existing.rows.length > 0) {
            masterId = existing.rows[0].id;
          } else {
            const insertRes = await client.query(
              `INSERT INTO locations_master (canonical_location, country, state) VALUES ($1, $2, $3) RETURNING id`,
              [rawValue, country || 'US', state || '']
            );
            masterId = insertRes.rows[0].id;
          }
        } else if (upperCategory === 'DEGREE') {
          const existing = await client.query(`SELECT id FROM degrees_master WHERE LOWER(canonical_degree) = LOWER($1) LIMIT 1`, [rawValue]);
          if (existing.rows.length > 0) {
            masterId = existing.rows[0].id;
          } else {
            const insertRes = await client.query(
              `INSERT INTO degrees_master (canonical_degree) VALUES ($1) RETURNING id`,
              [rawValue]
            );
            masterId = insertRes.rows[0].id;
          }
        } else {
          throw new Error(`Unsupported category: ${category}`);
        }

        // Also add the raw value as an alias to this master ID
        if (upperCategory === 'SKILL') {
          await client.query(`INSERT INTO skill_aliases (skill_id, alias_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'DESIGNATION') {
          await client.query(`INSERT INTO designation_aliases (designation_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'COMPANY') {
          await client.query(`INSERT INTO company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'LOCATION') {
          await client.query(`INSERT INTO location_aliases (location_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'DEGREE') {
          await client.query(`INSERT INTO degree_aliases (degree_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        }
      } else if (action === 'alias') {
        if (!masterId) {
          throw new Error(`canonicalId is required when mapping as an alias`);
        }
        if (upperCategory === 'SKILL') {
          await client.query(`INSERT INTO skill_aliases (skill_id, alias_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'DESIGNATION') {
          await client.query(`INSERT INTO designation_aliases (designation_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'COMPANY') {
          await client.query(`INSERT INTO company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'LOCATION') {
          await client.query(`INSERT INTO location_aliases (location_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else if (upperCategory === 'DEGREE') {
          await client.query(`INSERT INTO degree_aliases (degree_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [masterId, rawValue.toLowerCase()]);
        } else {
          throw new Error(`Unsupported category: ${category}`);
        }
      }

      // 3. Delete from pending_normalizations
      await client.query(`DELETE FROM pending_normalizations WHERE category = $1 AND raw_value = $2`, [category, rawValue]);

      await client.query('COMMIT');
      return { success: true, masterId };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to approve normalization: ${err.message}`, err.stack);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch active dictionary category list
   */
  async getCategoryDictionary(category: string): Promise<any[]> {
    const upperCategory = category.toUpperCase();
    this.logger.log(`Fetching active dictionary for category ${upperCategory}`);

    let sql = '';
    if (upperCategory === 'SKILL') {
      sql = `
        SELECT m.id, m.canonical_name AS name,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias_name)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM skills_master m
        LEFT JOIN skill_aliases a ON m.id = a.skill_id
        GROUP BY m.id, m.canonical_name
        ORDER BY m.canonical_name
      `;
    } else if (upperCategory === 'DESIGNATION') {
      sql = `
        SELECT m.id, m.canonical_designation AS name, m.seniority_level AS "seniorityLevel",
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM designations_master m
        LEFT JOIN designation_aliases a ON m.id = a.designation_id
        GROUP BY m.id, m.canonical_designation, m.seniority_level
        ORDER BY m.canonical_designation
      `;
    } else if (upperCategory === 'COMPANY') {
      sql = `
        SELECT m.id, m.canonical_company_name AS name,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM companies_master m
        LEFT JOIN company_aliases a ON m.id = a.company_id
        GROUP BY m.id, m.canonical_company_name
        ORDER BY m.canonical_company_name
      `;
    } else if (upperCategory === 'LOCATION') {
      sql = `
        SELECT m.id, m.canonical_location AS name, m.country, m.state,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM locations_master m
        LEFT JOIN location_aliases a ON m.id = a.location_id
        GROUP BY m.id, m.canonical_location, m.country, m.state
        ORDER BY m.canonical_location
      `;
    } else if (upperCategory === 'DEGREE') {
      sql = `
        SELECT m.id, m.canonical_degree AS name,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM degrees_master m
        LEFT JOIN degree_aliases a ON m.id = a.degree_id
        GROUP BY m.id, m.canonical_degree
        ORDER BY m.canonical_degree
      `;
    } else {
      throw new NotFoundException(`Unsupported dictionary category: ${category}`);
    }

    const res = await this.db.query(sql);
    return res.rows;
  }

  /**
   * Add a master term or alias to active dictionary
   */
  async addDictionaryTerm(category: string, body: any): Promise<any> {
    const upperCategory = category.toUpperCase();
    const { type, name, alias, masterId, country, state, seniorityLevel } = body;
    this.logger.log(`Adding term to ${upperCategory} dictionary: type=${type}`);

    if (type === 'canonical') {
      if (!name) throw new Error('name is required for canonical terms');
      let insertSql = '';
      let params: any[] = [];
      
      if (upperCategory === 'SKILL') {
        insertSql = `INSERT INTO skills_master (canonical_name, category_id) VALUES ($1, 1) RETURNING id`;
        params = [name];
      } else if (upperCategory === 'DESIGNATION') {
        insertSql = `INSERT INTO designations_master (canonical_designation, seniority_level) VALUES ($1, $2) RETURNING id`;
        params = [name, seniorityLevel || 'Mid'];
      } else if (upperCategory === 'COMPANY') {
        insertSql = `INSERT INTO companies_master (canonical_company_name) VALUES ($1) RETURNING id`;
        params = [name];
      } else if (upperCategory === 'LOCATION') {
        insertSql = `INSERT INTO locations_master (canonical_location, country, state) VALUES ($1, $2, $3) RETURNING id`;
        params = [name, country || 'US', state || ''];
      } else if (upperCategory === 'DEGREE') {
        insertSql = `INSERT INTO degrees_master (canonical_degree) VALUES ($1) RETURNING id`;
        params = [name];
      } else {
        throw new NotFoundException(`Unsupported category: ${category}`);
      }

      const res = await this.db.query(insertSql, params);
      const newId = res.rows[0].id;
      
      // Also automatically add an alias matching the name itself (lowercase)
      if (upperCategory === 'SKILL') {
        await this.db.query(`INSERT INTO skill_aliases (skill_id, alias_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newId, name.toLowerCase()]);
      } else if (upperCategory === 'DESIGNATION') {
        await this.db.query(`INSERT INTO designation_aliases (designation_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newId, name.toLowerCase()]);
      } else if (upperCategory === 'COMPANY') {
        await this.db.query(`INSERT INTO company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newId, name.toLowerCase()]);
      } else if (upperCategory === 'LOCATION') {
        await this.db.query(`INSERT INTO location_aliases (location_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newId, name.toLowerCase()]);
      } else if (upperCategory === 'DEGREE') {
        await this.db.query(`INSERT INTO degree_aliases (degree_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newId, name.toLowerCase()]);
      }

      return { id: newId, type: 'canonical', name };
    } else if (type === 'alias') {
      if (!alias || !masterId) throw new Error('alias and masterId are required for alias terms');
      let insertSql = '';
      let params: any[] = [];

      if (upperCategory === 'SKILL') {
        insertSql = `INSERT INTO skill_aliases (skill_id, alias_name) VALUES ($1, $2) RETURNING id`;
        params = [masterId, alias.toLowerCase()];
      } else if (upperCategory === 'DESIGNATION') {
        insertSql = `INSERT INTO designation_aliases (designation_id, alias) VALUES ($1, $2) RETURNING id`;
        params = [masterId, alias.toLowerCase()];
      } else if (upperCategory === 'COMPANY') {
        insertSql = `INSERT INTO company_aliases (company_id, alias) VALUES ($1, $2) RETURNING id`;
        params = [masterId, alias.toLowerCase()];
      } else if (upperCategory === 'LOCATION') {
        insertSql = `INSERT INTO location_aliases (location_id, alias) VALUES ($1, $2) RETURNING id`;
        params = [masterId, alias.toLowerCase()];
      } else if (upperCategory === 'DEGREE') {
        insertSql = `INSERT INTO degree_aliases (degree_id, alias) VALUES ($1, $2) RETURNING id`;
        params = [masterId, alias.toLowerCase()];
      } else {
        throw new NotFoundException(`Unsupported category: ${category}`);
      }

      const res = await this.db.query(insertSql, params);
      return { id: res.rows[0].id, type: 'alias', alias, masterId };
    } else {
      throw new Error(`Invalid add type: ${type}`);
    }
  }

  /**
   * Delete a master term or alias from active dictionary
   */
  async deleteDictionaryTerm(category: string, id: number, type: 'canonical' | 'alias'): Promise<any> {
    const upperCategory = category.toUpperCase();
    this.logger.log(`Deleting term from ${upperCategory} dictionary: id=${id}, type=${type}`);

    if (type === 'alias') {
      let deleteSql = '';
      if (upperCategory === 'SKILL') {
        deleteSql = `DELETE FROM skill_aliases WHERE id = $1`;
      } else if (upperCategory === 'DESIGNATION') {
        deleteSql = `DELETE FROM designation_aliases WHERE id = $1`;
      } else if (upperCategory === 'COMPANY') {
        deleteSql = `DELETE FROM company_aliases WHERE id = $1`;
      } else if (upperCategory === 'LOCATION') {
        deleteSql = `DELETE FROM location_aliases WHERE id = $1`;
      } else if (upperCategory === 'DEGREE') {
        deleteSql = `DELETE FROM degree_aliases WHERE id = $1`;
      } else {
        throw new NotFoundException(`Unsupported category: ${category}`);
      }
      await this.db.query(deleteSql, [id]);
      return { success: true };
    } else if (type === 'canonical') {
      const client = await this.db.getClient();
      try {
        await client.query('BEGIN');

        if (upperCategory === 'SKILL') {
          await client.query(`DELETE FROM skill_aliases WHERE skill_id = $1`, [id]);
          await client.query(`DELETE FROM skills_master WHERE id = $1`, [id]);
        } else if (upperCategory === 'DESIGNATION') {
          await client.query(`DELETE FROM designation_aliases WHERE designation_id = $1`, [id]);
          await client.query(`DELETE FROM designations_master WHERE id = $1`, [id]);
        } else if (upperCategory === 'COMPANY') {
          await client.query(`DELETE FROM company_aliases WHERE company_id = $1`, [id]);
          await client.query(`DELETE FROM companies_master WHERE id = $1`, [id]);
        } else if (upperCategory === 'LOCATION') {
          await client.query(`DELETE FROM location_aliases WHERE location_id = $1`, [id]);
          await client.query(`DELETE FROM locations_master WHERE id = $1`, [id]);
        } else if (upperCategory === 'DEGREE') {
          await client.query(`DELETE FROM degree_aliases WHERE degree_id = $1`, [id]);
          await client.query(`DELETE FROM degrees_master WHERE id = $1`, [id]);
        } else {
          throw new NotFoundException(`Unsupported category: ${category}`);
        }

        await client.query('COMMIT');
        return { success: true };
      } catch (err) {
        await client.query('ROLLBACK');
        this.logger.error(`Failed to delete canonical term: ${err.message}`, err.stack);
        throw err;
      } finally {
        client.release();
      }
    } else {
      throw new Error(`Invalid delete type: ${type}`);
    }
  }

  async updateCandidate(id: number, dto: any, tenantId: string): Promise<CandidateProfile> {
    this.logger.log(`Updating candidate details for ID=${id} and tenant=${tenantId}`);

    const existCheck = await this.db.query('SELECT 1 FROM candidates WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (existCheck.rows.length === 0) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found.`);
    }

    const fields: string[] = [];
    const params: any[] = [id, tenantId];
    let paramIndex = 3;

    const addField = (colName: string, val: any) => {
      if (val !== undefined) {
        fields.push(`${colName} = $${paramIndex}`);
        params.push(val === '' ? null : val);
        paramIndex++;
      }
    };

    addField('full_name', dto.fullName);
    addField('email', dto.email);
    addField('phone', dto.phone);
    addField('raw_current_location', dto.location);
    addField('raw_current_designation', dto.jobTitle);
    addField('work_authorization', dto.workAuthorization);
    addField('total_experience_years', dto.experienceYears);
    addField('current_ctc', dto.currentCTC);
    addField('expected_ctc', dto.expectedCTC);
    addField('notice_period_days', dto.noticePeriodDays);
    addField('serving_notice', dto.servingNotice);

    if (fields.length > 0) {
      const updateSql = `
        UPDATE candidates
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `;
      await this.db.query(updateSql, params);
    }

    return this.findOne(id, tenantId);
  }
}

