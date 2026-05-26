import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCandidateDto } from './dtos/create-candidate.dto';
import { CandidateQueryDto } from './dtos/candidate-query.dto';
import { CandidateProfile, CandidateDbRow } from './interfaces/candidate.interface';

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Safe SQL transaction to create a candidate and link their resume record in one step
   */
  async createCandidate(dto: CreateCandidateDto, tenantId: string): Promise<CandidateProfile> {
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

      // 2. Insert into candidates table with tenant_id
      const candidateResult = await client.query(
        `INSERT INTO candidates (full_name, email, phone, raw_current_location, total_experience_years, raw_current_designation, created_at, source, work_authorization, resume_record_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10)
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
        ]
      );
      
      const candidateId = candidateResult.rows[0].id;
      const createdAt = candidateResult.rows[0].created_at;

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
  async findAll(query: CandidateQueryDto, tenantId: string): Promise<CandidateProfile[]> {
    this.logger.log(`Fetching candidates from Supabase DB for tenant: ${tenantId}. Filters q="${query.q || 'None'}"`);
    
    let baseSql = `
      SELECT c.*, r.raw_text, r.parsed_json
      FROM candidates c
      LEFT JOIN resumes r ON c.resume_record_id = r.id
      WHERE c.tenant_id = $1
    `;
    const params: any[] = [tenantId];
    let paramIndex = 2;

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

    const limit = query.limit || 50;
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
    if (row.parsed_json) {
      const parsed = typeof row.parsed_json === 'string' ? JSON.parse(row.parsed_json) : row.parsed_json;
      skills = parsed.skills || [];
    }

    return {
      id: `INT-${row.source ? row.source.toUpperCase() : 'DB'}-${row.id}`,
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
    };
  }
}
