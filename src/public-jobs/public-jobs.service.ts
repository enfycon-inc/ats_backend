import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeJobDescription } from '../jobs/job-description-html';
import { careerPublicationDefaults } from '../jobs/career-publication';
import { submissionCompensation } from '../recruiter-submissions/submission-compensation';

type Scope = 'TENANT' | 'BRANCH' | 'BUSINESS_UNIT';
type KeyContext = { id: string; tenantId: string; scope: Scope; branchId: string | null; businessUnitId: string | null };

@Injectable()
export class PublicJobsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertTenantAdmin(user: any) {
    const permissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    if (!user?.dbId || !user?.tenantId || !(permissions.includes('tenant:settings') || permissions.includes('tenant:manage'))) {
      throw new ForbiddenException('Tenant administration permission is required.');
    }
  }

  async createKey(user: any, input: any) {
    this.assertTenantAdmin(user);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 120) throw new BadRequestException('Enter a key name (maximum 120 characters).');
    const scope = input.scope as Scope;
    if (!['TENANT', 'BRANCH', 'BUSINESS_UNIT'].includes(scope)) throw new BadRequestException('Select a valid key scope.');
    const expiresAt = new Date(input.expiresAt);
    const now = Date.now();
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now || expiresAt.getTime() > now + 366 * 86400000) {
      throw new BadRequestException('Key expiry must be within the next 366 days.');
    }
    const origins = Array.isArray(input.allowedOrigins) ? input.allowedOrigins : [];
    if (origins.length > 10 || origins.some((origin: unknown) => typeof origin !== 'string' || !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin))) {
      throw new BadRequestException('Allowed origins must be HTTPS origins (up to 10).');
    }
    const branchId = input.branchId || null;
    const businessUnitId = input.businessUnitId || null;
    if ((scope === 'TENANT' && (branchId || businessUnitId)) || (scope === 'BRANCH' && (!branchId || businessUnitId)) || (scope === 'BUSINESS_UNIT' && !businessUnitId)) {
      throw new BadRequestException('The selected scope requires matching branch or business unit details.');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId: user.tenantId, isActive: true }, select: { id: true } });
      if (!branch) throw new BadRequestException('The selected branch does not belong to your tenant.');
    }
    if (businessUnitId) {
      const unit = await this.prisma.businessUnit.findFirst({ where: { id: businessUnitId, tenantId: user.tenantId, ...(branchId ? { branchId } : {}), OR: [{ branchId: null }, { branch: { isActive: true } }] }, select: { id: true, branchId: true } });
      if (!unit) throw new BadRequestException('The selected business unit does not belong to the selected tenant and branch.');
    }
    const secret = `epk_live_${randomBytes(32).toString('base64url')}`;
    const key = await this.prisma.publicJobsApiKey.create({ data: {
      tenantId: user.tenantId, name, keyPrefix: secret.slice(0, 16), keyHash: createHash('sha256').update(secret).digest('hex'),
      scope, branchId: scope === 'TENANT' ? null : (branchId || (businessUnitId ? (await this.prisma.businessUnit.findUnique({ where: { id: businessUnitId }, select: { branchId: true } }))?.branchId : null)),
      businessUnitId: scope === 'BUSINESS_UNIT' ? businessUnitId : null, allowedOrigins: origins, expiresAt,
      createdBy: user.dbId,
    }, select: { id: true, name: true, keyPrefix: true, scope: true, branchId: true, businessUnitId: true, allowedOrigins: true, expiresAt: true, createdAt: true } });
    await this.prisma.auditLog.create({ data: { tenantId: user.tenantId, actorId: user.dbId, actorEmail: user.email, action: 'PUBLIC_JOBS_KEY_CREATED', targetType: 'public_jobs_api_key', targetId: key.id, details: { name, scope, branchId: key.branchId, businessUnitId: key.businessUnitId, expiresAt: expiresAt.toISOString() } } });
    return { ...key, secret, message: 'Copy this key now. It cannot be retrieved again.' };
  }

  async listKeys(user: any) {
    this.assertTenantAdmin(user);
    return this.prisma.publicJobsApiKey.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, keyPrefix: true, scope: true, branchId: true, businessUnitId: true, allowedOrigins: true, expiresAt: true, revokedAt: true, createdAt: true } });
  }

  async revokeKey(user: any, id: string) {
    this.assertTenantAdmin(user);
    const result = await this.prisma.publicJobsApiKey.updateMany({ where: { id, tenantId: user.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Active API key not found.');
    await this.prisma.auditLog.create({ data: { tenantId: user.tenantId, actorId: user.dbId, actorEmail: user.email, action: 'PUBLIC_JOBS_KEY_REVOKED', targetType: 'public_jobs_api_key', targetId: id, details: {} } });
    return { revoked: true };
  }

  async setPublished(user: any, jobId: string, publish: boolean) {
    const permissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
    if (!user?.dbId || !user?.tenantId || !(permissions.includes('job:edit') || permissions.includes('tenant:settings') || permissions.includes('tenant:manage'))) throw new ForbiddenException('Job edit permission is required.');
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId: user.tenantId, deletedAt: null }, select: { id: true, jobTitle: true, jobCode: true, status: true, approvalStatus: true, publicSlug: true, publicDescription: true, branchId: true, businessUnitId: true } });
    if (!job) throw new NotFoundException('Job not found.');
    const tenantWide = permissions.includes('tenant:settings') || permissions.includes('tenant:manage');
    if (!tenantWide && (!user.branchId || job.branchId !== user.branchId || (permissions.includes('unit_admin:manage') && job.businessUnitId !== user.businessUnitId))) throw new ForbiddenException('You cannot publish jobs outside your assigned scope.');
    if (job.status.toUpperCase() !== 'ACTIVE' || (job.approvalStatus && job.approvalStatus !== 'APPROVED')) throw new BadRequestException('Only active, approved jobs can be published or unpublished.');
    const slug = job.publicSlug || careerPublicationDefaults(job.jobTitle, job.jobCode).publicSlug;
    const updated = await this.prisma.$transaction(async tx => {
      const result = await tx.job.updateMany({ where: { id: job.id, tenantId: user.tenantId, deletedAt: null, status: { equals: 'ACTIVE', mode: 'insensitive' }, approvalStatus: job.approvalStatus }, data: { isPubliclyPublished: publish, publicSlug: slug } });
      if (!result.count) throw new BadRequestException('Job status changed. Refresh and try again.');
      await tx.auditLog.create({ data: { tenantId: user.tenantId, actorId: user.dbId, actorEmail: user.email, action: publish ? 'JOB_PUBLISHED_PUBLICLY' : 'JOB_UNPUBLISHED_PUBLICLY', targetType: 'job', targetId: job.id, details: { publicSlug: slug } } });
      return { id: job.id, publicSlug: slug, isPubliclyPublished: publish };
    });
    return updated;
  }

  private scopedWhere(key: KeyContext) {
    return { tenantId: key.tenantId, isPubliclyPublished: true, deletedAt: null, status: { in: ['ACTIVE', 'CLOSED'], mode: 'insensitive' as const }, AND: [{ OR: [{ approvalStatus: 'APPROVED' }, { approvalStatus: null }] }, { OR: [{ branchId: null }, { branch: { isActive: true } }] }], ...(key.scope === 'BRANCH' ? { branchId: key.branchId } : {}), ...(key.scope === 'BUSINESS_UNIT' ? { businessUnitId: key.businessUnitId } : {}) };
  }

  async listJobs(key: KeyContext, query: any) {
    const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit || '20', 10) || 20));
    const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
    if (cursor && (cursor.length > 180 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(cursor))) throw new BadRequestException('Invalid pagination cursor.');
    const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
    const where: any = this.scopedWhere(key);
    if (search) where.AND.push({ OR: [{ jobTitle: { contains: search, mode: 'insensitive' } }, { city: { contains: search, mode: 'insensitive' } }, { state: { contains: search, mode: 'insensitive' } }, { skillsRequired: { has: search } }] });
    const rows = await this.prisma.job.findMany({ where, take: limit + 1, ...(cursor ? { skip: 1, cursor: { publicSlug: cursor } } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, publicSlug: true, jobTitle: true, jobType: true, jobDescription: true, status: true, skillsRequired: true, state: true, city: true, country: true, workMode: true, market: true, expMin: true, expMax: true, createdAt: true } });
    const hasMore = rows.length > limit;
    const jobs = rows.slice(0, limit).map(({ id, publicSlug, jobDescription, ...job }) => ({ ...job, slug: publicSlug, description: sanitizeJobDescription(jobDescription || ''), acceptsApplications: job.status.toUpperCase() === 'ACTIVE', createdAt: job.createdAt.toISOString() }));
    return { data: jobs, nextCursor: hasMore ? rows[limit - 1].publicSlug : null };
  }

  async getJob(key: KeyContext, slug: string) {
    const job = await this.prisma.job.findFirst({ where: { ...this.scopedWhere(key), publicSlug: slug }, select: { publicSlug: true, jobTitle: true, jobType: true, jobDescription: true, status: true, skillsRequired: true, secondarySkills: true, state: true, city: true, country: true, workMode: true, market: true, expMin: true, expMax: true, industry: true, degree: true, duration: true, createdAt: true } });
    if (!job) throw new NotFoundException('Published job not found.');
    const { jobDescription, publicSlug, ...publicJob } = job;
    return { ...publicJob, slug: publicSlug, description: sanitizeJobDescription(jobDescription || ''), acceptsApplications: job.status.toUpperCase() === 'ACTIVE', createdAt: job.createdAt.toISOString() };
  }

  async apply(key: KeyContext, slug: string, body: any, file: any) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a resume file.');
    if (file.size > 8 * 1024 * 1024) throw new BadRequestException('Resume must be 8 MB or smaller.');
    const supportedMime = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const signature = file.mimetype === 'application/pdf' ? file.buffer.subarray(0, 5).toString() === '%PDF-' : file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
    if (!supportedMime.includes(file.mimetype) || !signature) throw new BadRequestException('Upload a valid PDF or DOCX resume.');
    const name = typeof body?.fullName === 'string' ? body.fullName.trim().slice(0, 255) : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 255) : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 50) : '';
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Enter your name and a valid email address.');
    if (body?.consent !== 'true') throw new BadRequestException('Candidate privacy consent is required.');
    const experience = (value: unknown, field: string) => {
      const text = String(value ?? '').trim();
      if (!/^\d+(?:\.\d)?$/.test(text) || Number(text) > 100) throw new BadRequestException(`Enter valid ${field} (0 to 100 years, up to one decimal place).`);
      return text;
    };
    const totalExperience = experience(body?.totalExperienceYears, 'total experience');
    const relevantExperience = experience(body?.relevantExperienceYears, 'relevant experience');
    if (Number(relevantExperience) > Number(totalExperience)) throw new BadRequestException('Relevant experience cannot exceed total experience.');
    const currentCompany = typeof body?.currentCompany === 'string' ? body.currentCompany.trim() : '';
    const currentLocation = typeof body?.currentLocation === 'string' ? body.currentLocation.trim() : '';
    if (!currentCompany || currentCompany.length > 255 || !currentLocation || currentLocation.length > 255) throw new BadRequestException('Current company and current location are required (maximum 255 characters each).');
    const preferredInput = body?.preferredLocations;
    const preferredLocations = (Array.isArray(preferredInput) ? preferredInput : typeof preferredInput === 'string' ? preferredInput.split(',') : [])
      .map((value: unknown) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean);
    const uniquePreferredLocations = [...new Set(preferredLocations)];
    if (!uniquePreferredLocations.length || uniquePreferredLocations.length > 20 || uniquePreferredLocations.some(location => location.length > 255)) throw new BadRequestException('Enter between 1 and 20 preferred locations, each up to 255 characters.');
    const noticePeriodText = String(body?.noticePeriodDays ?? '').trim();
    if (!/^\d{1,4}$/.test(noticePeriodText) || Number(noticePeriodText) > 3650) throw new BadRequestException('Enter a notice period from 0 to 3650 days.');
    const currentCtcText = String(body?.currentCompensation ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(currentCtcText) || Number(currentCtcText) <= 0 || Number(currentCtcText) > 99999999.99) throw new BadRequestException('Enter a valid positive Current CTC amount (up to two decimal places).');
    const expectedCtcText = String(body?.expectedCompensation ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(expectedCtcText) || Number(expectedCtcText) <= 0 || Number(expectedCtcText) > 99999999.99) throw new BadRequestException('Enter a valid positive Expected CTC amount (up to two decimal places).');
    const job = await this.prisma.job.findFirst({ where: { ...this.scopedWhere(key), status: { equals: 'ACTIVE', mode: 'insensitive' }, publicSlug: slug }, select: { id: true, branchId: true, businessUnitId: true, market: true, jobType: true } });
    if (!job) throw new NotFoundException('This job is no longer accepting applications.');
    const normalizedCompensation = submissionCompensation(body, job.jobType);
    const submissionId = randomUUID();
    const resumeId = randomUUID();
    let reference: string;
    try {
      reference = await this.prisma.$transaction(async tx => {
        // Serialize application creation with job closure and manual unpublishing.
        const accepting = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM ats.jobs WHERE id = ${job.id}::uuid AND tenant_id = ${key.tenantId}::uuid AND deleted_at IS NULL AND is_publicly_published = true AND UPPER(status) = 'ACTIVE' AND (approval_status = 'APPROVED' OR approval_status IS NULL) FOR UPDATE`;
        if (!accepting.length) throw new NotFoundException('This job is no longer accepting applications.');
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `${key.tenantId}:${job.id}:${email}`);
        const existing = await tx.candidate.findFirst({ where: { tenantId: key.tenantId, email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
        const candidateId = existing?.id || randomUUID();
        const dup = await tx.recruiterSubmission.findFirst({ where: { tenantId: key.tenantId, jobId: job.id, candidateId }, select: { id: true } });
        if (dup) return dup.id;
        await tx.resume.create({ data: { id: resumeId, filename: String(file.originalname || 'resume').slice(0, 255), candidateName: name, email, fileHash: createHash('sha256').update(file.buffer).digest('hex'), fileData: file.buffer, fileMime: file.mimetype, fileSize: file.size } });
        if (existing) {
          await tx.candidate.update({ where: { id: candidateId }, data: { resumeRecordId: resumeId, totalExperienceYears: totalExperience, relevantExperienceYears: relevantExperience, currentCompany, rawCurrentLocation: currentLocation, noticePeriodDays: Number(noticePeriodText), currentCtc: currentCtcText, expectedCtc: expectedCtcText, preferredLocations: uniquePreferredLocations } });
        } else {
          await tx.candidate.create({ data: { id: candidateId, tenantId: key.tenantId, branchId: job.branchId, firstName: name.split(/\s+/)[0], lastName: name.split(/\s+/).slice(1).join(' '), fullName: name, email, phone: phone || null, market: job.market || 'US', source: 'Company Website', totalExperienceYears: totalExperience, relevantExperienceYears: relevantExperience, currentCompany, rawCurrentLocation: currentLocation, noticePeriodDays: Number(noticePeriodText), currentCtc: currentCtcText, expectedCtc: expectedCtcText, preferredLocations: uniquePreferredLocations, skills: [], resumeRecordId: resumeId } });
        }
        await tx.recruiterSubmission.create({ data: { id: submissionId, tenantId: key.tenantId, jobId: job.id, candidateId, recruiterId: 'WEBSITE_APPLICANT', finalStatus: 'PENDING_APPROVAL', sourceCategory: 'Market', sourceChannel: 'Direct Application', sourceDetail: 'Website', l1Status: 'PENDING', l2Status: 'PENDING', l3Status: 'PENDING', ...normalizedCompensation, candidateCurrentCtc: currentCtcText, candidateExpectedCtc: expectedCtcText, candidateCtcCurrency: body.compensationCurrency, candidateCtcTerm: body.compensationInputUnit, candidateNoticePeriod: Number(noticePeriodText), candidateRelevantExperience: relevantExperience, candidatePreferredLocations: uniquePreferredLocations } });
        await tx.job.update({ where: { id: job.id }, data: { submissionDone: { increment: 1 } } });
        await tx.submissionEvent.create({ data: { tenantId: key.tenantId, submissionId, actorId: null, actorName: 'Website Applicant', kind: 'CREATED', sequence: 0, requestId: submissionId, requestHash: createHash('sha256').update(`${key.id}:${job.id}:${email}:${submissionId}`).digest('hex'), details: { source: 'Company Website', consent: true } } });
        return submissionId;
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('An application for this email and job has already been received.');
      throw error;
    }
    return { received: true, reference };
  }
}
