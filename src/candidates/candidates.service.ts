import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCandidateDto } from './dtos/create-candidate.dto';
import { CandidateQueryDto } from './dtos/candidate-query.dto';
import { CandidateProfile } from './interfaces/candidate.interface';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

/** The original CV file bytes plus metadata, for download/preview. */
export interface StoredResumeFile {
  data: Buffer;
  mime: string;
  filename: string;
}

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Safe transaction to create a candidate and link their resume record in one step
   */
  async createCandidate(dto: CreateCandidateDto, tenantId: string, user?: AuthUser): Promise<CandidateProfile> {
    this.logger.log(`Creating database records for candidate: ${dto.fullName} (${dto.email}) for tenant: ${tenantId}`);

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

    const candidate = await this.prisma.$transaction(async (tx) => {
      const resume = await tx.resume.create({
        data: {
          filename: `${dto.source.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}.html`,
          candidateName: dto.fullName,
          email: dto.email,
          fileHash: `external-${dto.source.toLowerCase()}-${Math.floor(100000 + Math.random() * 900000)}`,
          parsedJson: resumeJson,
          rawText: dto.rawText,
        },
      });

      const cand = await tx.candidate.create({
        data: {
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          rawCurrentLocation: dto.location,
          totalExperienceYears: dto.experienceYears ? Number(dto.experienceYears) : 0,
          rawCurrentDesignation: dto.jobTitle,
          source: dto.source,
          workAuthorization: dto.workAuthorization,
          resumeRecordId: resume.id,
          tenantId,
          uploadedByUserId: user?.dbId || null,
          uploadedByName: user?.fullName || user?.email || 'System Upload',
        },
      });

      const candidateCode = `CAN-${String(cand.id).padStart(6, '0')}`;
      return tx.candidate.update({
        where: { id: cand.id },
        data: { candidateCode },
        include: { resumeRecord: true },
      });
    });

    return this.mapCandidateToProfile(candidate);
  }

  /**
   * Fetches and maps candidates using filters, dynamic keywords, and limits, scoped by tenant
   */
  async findAll(query: CandidateQueryDto, tenantId: string, user?: AuthUser): Promise<CandidateProfile[]> {
    this.logger.log(`Fetching candidates for tenant: ${tenantId}. Filters q="${query.q || 'None'}", market="${query.market || 'Auto'}"`);

    let poolMode = 'COMBINED_MARKET';
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { candidatePoolMode: true },
      });
      if (tenant?.candidatePoolMode) {
        poolMode = tenant.candidatePoolMode;
      }
    } catch (err: any) {
      this.logger.debug(`Could not read tenant candidate_pool_mode: ${err.message}`);
    }

    const where: any = {
      tenantId,
      deletedAt: null,
    };

    if (query.market && !query.allMarkets) {
      const effectiveMarket = query.market.toUpperCase();
      where.OR = [
        { market: { equals: effectiveMarket, mode: 'insensitive' } },
        ...(effectiveMarket === 'US' ? [{ market: null }] : []),
      ];
    }

    const canSearchAllBranches =
      user?.permissions?.includes('candidate:search_all_branches') ||
      user?.roles?.includes('ADMIN') ||
      user?.roles?.includes('SUPER_ADMIN');

    if (query.branchId && !query.allBranches) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [{ branchId: query.branchId }, { branchId: null }],
        },
      ];
    } else if (poolMode === 'STRICT_BRANCH' && user?.branchId && !canSearchAllBranches && !query.allBranches) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [{ branchId: user.branchId }, { branchId: null }],
        },
      ];
    }

    if (query.source) {
      where.source = query.source;
    }

    if (query.q && query.q !== '*') {
      const lowerQ = query.q.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { fullName: { contains: lowerQ, mode: 'insensitive' } },
            { rawCurrentDesignation: { contains: lowerQ, mode: 'insensitive' } },
            { resumeRecord: { rawText: { contains: lowerQ, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const limit = query.limit || 5000;
    const skip = query.offset || 0;

    try {
      const candidates = await this.prisma.candidate.findMany({
        where,
        include: {
          resumeRecord: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      });

      return candidates.map((row) => this.mapCandidateToProfile(row));
    } catch (err: any) {
      this.logger.error(`Failed to fetch candidates: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Retrieves a single candidate with joined resumes details, scoped by tenant
   */
  async findOne(id: number, tenantId: string): Promise<CandidateProfile> {
    this.logger.log(`Fetching candidate detail for ID=${id} and tenant=${tenantId}`);

    const candidate = await this.prisma.candidate.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      include: {
        resumeRecord: true,
      },
    });

    if (!candidate) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found.`);
    }

    return this.mapCandidateToProfile(candidate);
  }

  /**
   * Finds a candidate by their email address for de-duplication checks, scoped by tenant
   */
  async findByEmail(email: string, tenantId: string): Promise<CandidateProfile | null> {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        tenantId,
        deletedAt: null,
      },
      include: {
        resumeRecord: true,
      },
    });

    return candidate ? this.mapCandidateToProfile(candidate) : null;
  }

  /**
   * Soft deletes a candidate by ID, scoped by tenant
   */
  async deleteCandidate(id: number, tenantId: string): Promise<{ message: string }> {
    this.logger.log(`Soft deleting Candidate ID=${id} for tenant: ${tenantId}`);
    const existing = await this.prisma.candidate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found or already deleted.`);
    }

    await this.prisma.candidate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: `Candidate with ID ${id} was successfully soft-deleted.` };
  }

  /**
   * Restores a soft-deleted candidate by ID, scoped by tenant
   */
  async restoreCandidate(id: number, tenantId: string): Promise<CandidateProfile> {
    this.logger.log(`Restoring Candidate ID=${id} for tenant: ${tenantId}`);
    const existing = await this.prisma.candidate.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!existing) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found or not deleted.`);
    }

    await this.prisma.candidate.update({
      where: { id },
      data: { deletedAt: null },
    });

    return this.findOne(id, tenantId);
  }

  /**
   * Utility method to map Prisma candidate models to typed candidate profile payloads
   */
  private mapCandidateToProfile(row: any): CandidateProfile {
    const locationParts = (row.rawCurrentLocation || '').split(/,\s*/);
    const city = locationParts[0] || 'Unknown';
    const state = locationParts[1] || 'Unknown';

    let skills: string[] = [];
    let parsedJsonObj: any = null;
    const resume = row.resumeRecord;
    if (resume?.parsedJson) {
      parsedJsonObj = typeof resume.parsedJson === 'string' ? JSON.parse(resume.parsedJson) : resume.parsedJson;
      skills = parsedJsonObj.skills || [];
    }

    const candidateCode = row.candidateCode || `CAN-${String(row.id).padStart(6, '0')}`;
    const uploadedByName =
      row.uploadedByName || (row.source === 'Bulk Upload Benchmark' ? 'System Benchmark' : 'System');

    return {
      id: `INT-${row.source ? row.source.toUpperCase() : 'DB'}-${row.id}`,
      dbId: row.id,
      candidateCode,
      uploadedByUserId: row.uploadedByUserId || null,
      uploadedByName,
      applicantId: `APP-${row.id}`,
      fullName: row.fullName || (row.firstName ? `${row.firstName} ${row.lastName || ''}`.trim() : 'Unnamed Candidate'),
      email: row.email,
      phone: row.phone,
      city,
      state,
      source: row.source || 'Direct Upload',
      status: 'New lead',
      jobTitle: row.rawCurrentDesignation || 'Unknown',
      skills,
      workAuthorization: row.workAuthorization || 'US Authorized',
      experienceYears: row.totalExperienceYears ? Number(row.totalExperienceYears) : 0,
      rawText: resume?.rawText || '',
      createdOn: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      currentCTC: row.currentCtc ? Number(row.currentCtc) : null,
      expectedCTC: row.expectedCtc ? Number(row.expectedCtc) : null,
      noticePeriodDays: row.noticePeriodDays ? Number(row.noticePeriodDays) : 0,
      servingNotice: !!row.servingNotice,
      lastWorkingDay: row.lastWorkingDay || null,
      panCard: row.panCard || null,
      preferredLocations: row.preferredLocations || [],
      parsedJson: parsedJsonObj,
    };
  }

  /**
   * Find an existing candidate by resume file hash (de-duplication), scoped by tenant.
   */
  async findByHash(fileHash: string, tenantId: string): Promise<CandidateProfile | null> {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        tenantId,
        resumeRecord: {
          fileHash,
        },
      },
      include: {
        resumeRecord: true,
      },
    });

    return candidate ? this.mapCandidateToProfile(candidate) : null;
  }

  /**
   * CV SAVE MECHANISM — upload a resume file, parse it (best-effort via the Python
   * parser), and persist the original file + structured candidate in one transaction.
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

    let parsed: any = null;

    // 1. De-duplicate on exact file hash.
    const existing = await this.findByHash(fileHash, tenantId);
    if (existing) {
      const hasOverrideEmail = !!meta.email && !meta.email.includes('@import.local');
      const hasOverrideName = !!meta.fullName && meta.fullName.trim() !== '' && meta.fullName.trim() !== 'Unnamed Candidate';

      const existingEmail = existing.email?.toLowerCase().trim();
      const overrideEmail = meta.email?.toLowerCase().trim();
      const existingName = existing.fullName?.toLowerCase().trim();
      const overrideName = meta.fullName?.toLowerCase().trim();

      const emailMatches = hasOverrideEmail && existingEmail && overrideEmail === existingEmail;
      const emailDiffers = hasOverrideEmail && existingEmail && overrideEmail !== existingEmail;
      const nameDiffers = hasOverrideName && existingName && overrideName !== existingName;

      // Smart De-duplication:
      // If caller explicitly provided an email or name that differs from the existing candidate,
      // do NOT hijack the submission to the old candidate.
      if (emailDiffers || (hasOverrideName && nameDiffers && !emailMatches)) {
        this.logger.log(
          `CV file hash matched existing candidate ${existing.fullName} (${existing.email}), but caller provided different identity (${meta.fullName || 'no-name'} / ${meta.email || 'no-email'}). Bypassing hash de-duplication to honor caller's candidate.`
        );
        if (existing.parsedJson) {
          parsed = existing.parsedJson;
        }
      } else {
        this.logger.log(`CV already imported (hash ${fileHash.slice(0, 12)}…) → returning existing candidate.`);
        return { candidate: existing, duplicate: true, parsed: false };
      }
    }

    // 2. Best-effort parse via the Python service (skip if cached parsedJson already available).
    if (!parsed) {
      try {
        parsed = await this.parseResumeFile(file);
      } catch (err: any) {
        this.logger.warn(`Parser unavailable, saving CV with basic metadata only: ${err.message}`);
      }
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
    const expYears = parsed?.experience_years ?? parsed?.experience_detailed?.length ?? 0;
    const rawText = parsed?.raw_text || (parsed?.word_count ? parsed?.raw_text || '' : '') || (existing?.rawText || '');

    // 3. De-duplicate on Email (Option A - Update profile if email exists)
    const isRealEmail = email && !email.includes('@import.local');
    if (isRealEmail) {
      const existingCand = await this.prisma.candidate.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, tenantId },
      });

      if (existingCand) {
        this.logger.log(`Candidate with email ${email} already exists (ID=${existingCand.id}). Updating profile with new CV.`);

        const updated = await this.prisma.$transaction(async (tx) => {
          const resume = await tx.resume.create({
            data: {
              filename: file.originalname,
              candidateName: fullName,
              email,
              fileHash,
              parsedJson: parsed || { candidate_name: fullName, skills },
              rawText,
              fileData: new Uint8Array(file.buffer),
              fileMime: file.mimetype || 'application/octet-stream',
              fileSize: file.size ?? file.buffer.length,
            },
          });

          return tx.candidate.update({
            where: { id: existingCand.id },
            data: {
              fullName,
              phone,
              rawCurrentLocation: location,
              totalExperienceYears: expYears ? Number(expYears) : 0,
              rawCurrentDesignation: designation,
              workAuthorization: workAuth,
              resumeRecordId: resume.id,
              uploadedByUserId: existingCand.uploadedByUserId || uploaderId,
              uploadedByName: existingCand.uploadedByName || uploaderName,
            },
            include: { resumeRecord: true },
          });
        });

        return { candidate: this.mapCandidateToProfile(updated), duplicate: true, updated: true, parsed: true };
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const resume = await tx.resume.create({
        data: {
          filename: file.originalname,
          candidateName: fullName,
          email,
          fileHash,
          parsedJson: parsed || { candidate_name: fullName, skills },
          rawText,
          fileData: new Uint8Array(file.buffer),
          fileMime: file.mimetype || 'application/octet-stream',
          fileSize: file.size ?? file.buffer.length,
        },
      });

      const cand = await tx.candidate.create({
        data: {
          fullName,
          email,
          phone,
          rawCurrentLocation: location,
          totalExperienceYears: expYears ? Number(expYears) : 0,
          rawCurrentDesignation: designation,
          source: meta.source || 'CV Upload',
          workAuthorization: workAuth,
          resumeRecordId: resume.id,
          tenantId,
          branchId: meta.branchId || null,
          market: meta.market || 'US',
          uploadedByUserId: uploaderId,
          uploadedByName: uploaderName,
        },
      });

      const candidateCode = `CAN-${String(cand.id).padStart(6, '0')}`;
      return tx.candidate.update({
        where: { id: cand.id },
        data: { candidateCode },
        include: { resumeRecord: true },
      });
    });

    const candidateProfile = this.mapCandidateToProfile(created);
    this.logger.log(`Saved CV for "${fullName}" (${created.candidateCode}, ID=${created.id}, uploadedBy=${uploaderName}, parsed=${!!parsed}).`);
    return { candidate: candidateProfile, duplicate: false, parsed: !!parsed };
  }

  /**
   * Retrieve the original stored CV file for a candidate (for download/preview).
   */
  async getResumeFile(candidateId: number, tenantId: string): Promise<StoredResumeFile> {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, tenantId },
      include: { resumeRecord: true },
    });

    if (!candidate || !candidate.resumeRecord?.fileData) {
      throw new NotFoundException(`No stored CV file for candidate ${candidateId}.`);
    }

    const resume = candidate.resumeRecord;
    return {
      data: Buffer.from(resume.fileData!),
      mime: resume.fileMime || 'application/octet-stream',
      filename: resume.filename || `candidate-${candidateId}-cv`,
    };
  }

  /**
   * Uploads a manual CV file to FastAPI and polls the task status
   */
  async parseResumeFile(file: any): Promise<any> {
    if (file?.buffer) {
      const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const cachedResume = await this.prisma.resume.findFirst({
        where: { fileHash },
        select: {
          parsedJson: true,
          candidateName: true,
          email: true,
          candidates: {
            select: { firstName: true, lastName: true, fullName: true, email: true, phone: true },
            take: 1,
            orderBy: { id: 'desc' },
          },
        },
        orderBy: { id: 'desc' },
      });
      if (cachedResume?.parsedJson) {
        let cached =
          typeof cachedResume.parsedJson === 'string'
            ? JSON.parse(cachedResume.parsedJson)
            : { ...(cachedResume.parsedJson as any) };

        const linkedCandidate = cachedResume.candidates?.[0];
        const contact = cached.contact || {};
        const emails = contact.emails || (cached.email ? [cached.email] : []);
        const phones = contact.phones || (cached.phone ? [cached.phone] : []);

        const finalEmail = emails[0] || cachedResume.email || linkedCandidate?.email || '';
        const finalPhone = phones[0] || linkedCandidate?.phone || '';
        const rawName = (cached.candidate_name && cached.candidate_name !== 'Unknown' && !cached.candidate_name.toLowerCase().includes('final_cv') && !cached.candidate_name.toLowerCase().includes('final cv'))
          ? cached.candidate_name
          : (cachedResume.candidateName || linkedCandidate?.fullName || (linkedCandidate?.firstName ? `${linkedCandidate.firstName} ${linkedCandidate.lastName || ''}`.trim() : ''));

        if (rawName && (!cached.candidate_name || cached.candidate_name === 'Unknown' || cached.candidate_name.toLowerCase().includes('cv'))) {
          cached.candidate_name = rawName;
        }
        if (!cached.contact) cached.contact = {};
        if (finalEmail && (!cached.contact.emails || cached.contact.emails.length === 0)) {
          cached.contact.emails = [finalEmail];
        }
        if (finalPhone && (!cached.contact.phones || cached.contact.phones.length === 0)) {
          cached.contact.phones = [finalPhone];
        }
        if (finalEmail && !cached.email) cached.email = finalEmail;
        if (finalPhone && !cached.phone) cached.phone = finalPhone;

        this.logger.log(`[FILE PARSER] Fast cache hit for hash ${fileHash.slice(0, 10)}: ${cached.candidate_name} (${finalEmail})`);
        return cached;
      }
    }

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
    try {
      const rows: any = await this.prisma.$queryRawUnsafe(
        `SELECT id, category, raw_value AS "rawValue", detected_count AS "detectedCount", created_at AS "createdAt"
         FROM ats.pending_normalizations
         ORDER BY detected_count DESC, created_at DESC`,
      );
      return rows || [];
    } catch {
      return [];
    }
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

    const upperCategory = category.toUpperCase();
    let masterId = canonicalId;

    await this.prisma.$transaction(async (tx) => {
      if (action === 'canonical') {
        if (upperCategory === 'SKILL') {
          const existing: any = await tx.$queryRawUnsafe(
            `SELECT id FROM ats.skills_master WHERE LOWER(canonical_name) = LOWER($1) LIMIT 1`,
            rawValue,
          );
          if (existing && existing.length > 0) {
            masterId = existing[0].id;
          } else {
            const inserted: any = await tx.$queryRawUnsafe(
              `INSERT INTO ats.skills_master (canonical_name, category_id) VALUES ($1, 1) RETURNING id`,
              rawValue,
            );
            masterId = inserted[0].id;
          }
        } else if (upperCategory === 'DESIGNATION') {
          const existing: any = await tx.$queryRawUnsafe(
            `SELECT id FROM ats.designations_master WHERE LOWER(canonical_designation) = LOWER($1) LIMIT 1`,
            rawValue,
          );
          if (existing && existing.length > 0) {
            masterId = existing[0].id;
          } else {
            const inserted: any = await tx.$queryRawUnsafe(
              `INSERT INTO ats.designations_master (canonical_designation, seniority_level) VALUES ($1, $2) RETURNING id`,
              rawValue,
              seniorityLevel || 'Mid',
            );
            masterId = inserted[0].id;
          }
        } else if (upperCategory === 'COMPANY') {
          const existing: any = await tx.$queryRawUnsafe(
            `SELECT id FROM ats.companies_master WHERE LOWER(canonical_company_name) = LOWER($1) LIMIT 1`,
            rawValue,
          );
          if (existing && existing.length > 0) {
            masterId = existing[0].id;
          } else {
            const inserted: any = await tx.$queryRawUnsafe(
              `INSERT INTO ats.companies_master (canonical_company_name) VALUES ($1) RETURNING id`,
              rawValue,
            );
            masterId = inserted[0].id;
          }
        } else if (upperCategory === 'LOCATION') {
          const existing: any = await tx.$queryRawUnsafe(
            `SELECT id FROM ats.locations_master WHERE LOWER(canonical_location) = LOWER($1) LIMIT 1`,
            rawValue,
          );
          if (existing && existing.length > 0) {
            masterId = existing[0].id;
          } else {
            const inserted: any = await tx.$queryRawUnsafe(
              `INSERT INTO ats.locations_master (canonical_location, country, state) VALUES ($1, $2, $3) RETURNING id`,
              rawValue,
              country || 'US',
              state || '',
            );
            masterId = inserted[0].id;
          }
        } else if (upperCategory === 'DEGREE') {
          const existing: any = await tx.$queryRawUnsafe(
            `SELECT id FROM ats.degrees_master WHERE LOWER(canonical_degree) = LOWER($1) LIMIT 1`,
            rawValue,
          );
          if (existing && existing.length > 0) {
            masterId = existing[0].id;
          } else {
            const inserted: any = await tx.$queryRawUnsafe(
              `INSERT INTO ats.degrees_master (canonical_degree) VALUES ($1) RETURNING id`,
              rawValue,
            );
            masterId = inserted[0].id;
          }
        } else {
          throw new Error(`Unsupported category: ${category}`);
        }

        // Add alias matching name
        if (upperCategory === 'SKILL') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.skill_aliases (skill_id, alias_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'DESIGNATION') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.designation_aliases (designation_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'COMPANY') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'LOCATION') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.location_aliases (location_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'DEGREE') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.degree_aliases (degree_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        }
      } else if (action === 'alias') {
        if (!masterId) {
          throw new Error(`canonicalId is required when mapping as an alias`);
        }
        if (upperCategory === 'SKILL') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.skill_aliases (skill_id, alias_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'DESIGNATION') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.designation_aliases (designation_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'COMPANY') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'LOCATION') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.location_aliases (location_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        } else if (upperCategory === 'DEGREE') {
          await tx.$executeRawUnsafe(
            `INSERT INTO ats.degree_aliases (degree_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            masterId,
            rawValue.toLowerCase(),
          );
        }
      }

      await tx.$executeRawUnsafe(
        `DELETE FROM ats.pending_normalizations WHERE category = $1 AND raw_value = $2`,
        category,
        rawValue,
      );
    });

    return { success: true, masterId };
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
        FROM ats.skills_master m
        LEFT JOIN ats.skill_aliases a ON m.id = a.skill_id
        GROUP BY m.id, m.canonical_name
        ORDER BY m.canonical_name
      `;
    } else if (upperCategory === 'DESIGNATION') {
      sql = `
        SELECT m.id, m.canonical_designation AS name, m.seniority_level AS "seniorityLevel",
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM ats.designations_master m
        LEFT JOIN ats.designation_aliases a ON m.id = a.designation_id
        GROUP BY m.id, m.canonical_designation, m.seniority_level
        ORDER BY m.canonical_designation
      `;
    } else if (upperCategory === 'COMPANY') {
      sql = `
        SELECT m.id, m.canonical_company_name AS name,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM ats.companies_master m
        LEFT JOIN ats.company_aliases a ON m.id = a.company_id
        GROUP BY m.id, m.canonical_company_name
        ORDER BY m.canonical_company_name
      `;
    } else if (upperCategory === 'LOCATION') {
      sql = `
        SELECT m.id, m.canonical_location AS name, m.country, m.state,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM ats.locations_master m
        LEFT JOIN ats.location_aliases a ON m.id = a.location_id
        GROUP BY m.id, m.canonical_location, m.country, m.state
        ORDER BY m.canonical_location
      `;
    } else if (upperCategory === 'DEGREE') {
      sql = `
        SELECT m.id, m.canonical_degree AS name,
               COALESCE(json_agg(json_build_object('id', a.id, 'name', a.alias)) FILTER (WHERE a.id IS NOT NULL), '[]') AS aliases
        FROM ats.degrees_master m
        LEFT JOIN ats.degree_aliases a ON m.id = a.degree_id
        GROUP BY m.id, m.canonical_degree
        ORDER BY m.canonical_degree
      `;
    } else {
      throw new NotFoundException(`Unsupported dictionary category: ${category}`);
    }

    try {
      const rows: any = await this.prisma.$queryRawUnsafe(sql);
      return rows || [];
    } catch {
      return [];
    }
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

      return await this.prisma.$transaction(async (tx) => {
        let insertSql = '';
        let params: any[] = [];

        if (upperCategory === 'SKILL') {
          insertSql = `INSERT INTO ats.skills_master (canonical_name, category_id) VALUES ($1, 1) RETURNING id`;
          params = [name];
        } else if (upperCategory === 'DESIGNATION') {
          insertSql = `INSERT INTO ats.designations_master (canonical_designation, seniority_level) VALUES ($1, $2) RETURNING id`;
          params = [name, seniorityLevel || 'Mid'];
        } else if (upperCategory === 'COMPANY') {
          insertSql = `INSERT INTO ats.companies_master (canonical_company_name) VALUES ($1) RETURNING id`;
          params = [name];
        } else if (upperCategory === 'LOCATION') {
          insertSql = `INSERT INTO ats.locations_master (canonical_location, country, state) VALUES ($1, $2, $3) RETURNING id`;
          params = [name, country || 'US', state || ''];
        } else if (upperCategory === 'DEGREE') {
          insertSql = `INSERT INTO ats.degrees_master (canonical_degree) VALUES ($1) RETURNING id`;
          params = [name];
        } else {
          throw new NotFoundException(`Unsupported category: ${category}`);
        }

        const res: any = await tx.$queryRawUnsafe(insertSql, ...params);
        const newId = res[0].id;

        if (upperCategory === 'SKILL') {
          await tx.$executeRawUnsafe(`INSERT INTO ats.skill_aliases (skill_id, alias_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, newId, name.toLowerCase());
        } else if (upperCategory === 'DESIGNATION') {
          await tx.$executeRawUnsafe(`INSERT INTO ats.designation_aliases (designation_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, newId, name.toLowerCase());
        } else if (upperCategory === 'COMPANY') {
          await tx.$executeRawUnsafe(`INSERT INTO ats.company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, newId, name.toLowerCase());
        } else if (upperCategory === 'LOCATION') {
          await tx.$executeRawUnsafe(`INSERT INTO ats.location_aliases (location_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, newId, name.toLowerCase());
        } else if (upperCategory === 'DEGREE') {
          await tx.$executeRawUnsafe(`INSERT INTO ats.degree_aliases (degree_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`, newId, name.toLowerCase());
        }

        return { id: newId, type: 'canonical', name };
      });
    } else if (type === 'alias') {
      if (!alias || !masterId) throw new Error('alias and masterId are required for alias terms');

      let insertSql = '';
      if (upperCategory === 'SKILL') {
        insertSql = `INSERT INTO ats.skill_aliases (skill_id, alias_name) VALUES ($1, $2) RETURNING id`;
      } else if (upperCategory === 'DESIGNATION') {
        insertSql = `INSERT INTO ats.designation_aliases (designation_id, alias) VALUES ($1, $2) RETURNING id`;
      } else if (upperCategory === 'COMPANY') {
        insertSql = `INSERT INTO ats.company_aliases (company_id, alias) VALUES ($1, $2) RETURNING id`;
      } else if (upperCategory === 'LOCATION') {
        insertSql = `INSERT INTO ats.location_aliases (location_id, alias) VALUES ($1, $2) RETURNING id`;
      } else if (upperCategory === 'DEGREE') {
        insertSql = `INSERT INTO ats.degree_aliases (degree_id, alias) VALUES ($1, $2) RETURNING id`;
      } else {
        throw new NotFoundException(`Unsupported category: ${category}`);
      }

      const res: any = await this.prisma.$queryRawUnsafe(insertSql, masterId, alias.toLowerCase());
      return { id: res[0].id, type: 'alias', alias, masterId };
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
        deleteSql = `DELETE FROM ats.skill_aliases WHERE id = $1`;
      } else if (upperCategory === 'DESIGNATION') {
        deleteSql = `DELETE FROM ats.designation_aliases WHERE id = $1`;
      } else if (upperCategory === 'COMPANY') {
        deleteSql = `DELETE FROM ats.company_aliases WHERE id = $1`;
      } else if (upperCategory === 'LOCATION') {
        deleteSql = `DELETE FROM ats.location_aliases WHERE id = $1`;
      } else if (upperCategory === 'DEGREE') {
        deleteSql = `DELETE FROM ats.degree_aliases WHERE id = $1`;
      } else {
        throw new NotFoundException(`Unsupported category: ${category}`);
      }
      await this.prisma.$executeRawUnsafe(deleteSql, id);
      return { success: true };
    } else if (type === 'canonical') {
      await this.prisma.$transaction(async (tx) => {
        if (upperCategory === 'SKILL') {
          await tx.$executeRawUnsafe(`DELETE FROM ats.skill_aliases WHERE skill_id = $1`, id);
          await tx.$executeRawUnsafe(`DELETE FROM ats.skills_master WHERE id = $1`, id);
        } else if (upperCategory === 'DESIGNATION') {
          await tx.$executeRawUnsafe(`DELETE FROM ats.designation_aliases WHERE designation_id = $1`, id);
          await tx.$executeRawUnsafe(`DELETE FROM ats.designations_master WHERE id = $1`, id);
        } else if (upperCategory === 'COMPANY') {
          await tx.$executeRawUnsafe(`DELETE FROM ats.company_aliases WHERE company_id = $1`, id);
          await tx.$executeRawUnsafe(`DELETE FROM ats.companies_master WHERE id = $1`, id);
        } else if (upperCategory === 'LOCATION') {
          await tx.$executeRawUnsafe(`DELETE FROM ats.location_aliases WHERE location_id = $1`, id);
          await tx.$executeRawUnsafe(`DELETE FROM ats.locations_master WHERE id = $1`, id);
        } else if (upperCategory === 'DEGREE') {
          await tx.$executeRawUnsafe(`DELETE FROM ats.degree_aliases WHERE degree_id = $1`, id);
          await tx.$executeRawUnsafe(`DELETE FROM ats.degrees_master WHERE id = $1`, id);
        } else {
          throw new NotFoundException(`Unsupported category: ${category}`);
        }
      });
      return { success: true };
    } else {
      throw new Error(`Invalid delete type: ${type}`);
    }
  }

  async updateCandidate(id: number, dto: any, tenantId: string): Promise<CandidateProfile> {
    this.logger.log(`Updating candidate details for ID=${id} and tenant=${tenantId}`);

    const existing = await this.prisma.candidate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Candidate profile with ID ${id} was not found.`);
    }

    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.location !== undefined) data.rawCurrentLocation = dto.location;
    if (dto.jobTitle !== undefined) data.rawCurrentDesignation = dto.jobTitle;
    if (dto.workAuthorization !== undefined) data.workAuthorization = dto.workAuthorization;
    if (dto.experienceYears !== undefined)
      data.totalExperienceYears = dto.experienceYears !== '' && dto.experienceYears !== null ? Number(dto.experienceYears) : null;
    if (dto.currentCTC !== undefined)
      data.currentCtc = dto.currentCTC !== '' && dto.currentCTC !== null ? Number(dto.currentCTC) : null;
    if (dto.expectedCTC !== undefined)
      data.expectedCtc = dto.expectedCTC !== '' && dto.expectedCTC !== null ? Number(dto.expectedCTC) : null;
    if (dto.noticePeriodDays !== undefined)
      data.noticePeriodDays = dto.noticePeriodDays !== '' && dto.noticePeriodDays !== null ? Number(dto.noticePeriodDays) : 0;
    if (dto.servingNotice !== undefined) data.servingNotice = Boolean(dto.servingNotice);

    if (Object.keys(data).length > 0) {
      await this.prisma.candidate.update({
        where: { id },
        data,
      });
    }

    return this.findOne(id, tenantId);
  }
}
