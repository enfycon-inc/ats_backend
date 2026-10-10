import { randomUUID } from 'node:crypto';
import { assessCandidate } from '../jobs/candidate-assessment';
import { historySnapshot, historyChanges, saveRequestHash } from './submission-history';
import { currentTrackerRound, trackerBucketConditions } from './tracker-workflow';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { submissionCapabilities } from './submission-capabilities';
import { validateTrackerUpdate } from './validate-tracker-update';
import type { SubmissionCapabilities, TrackerBucket, TrackerSubmission } from './tracker-contract';

export interface SubmissionDetails extends TrackerSubmission {
  capabilities?: SubmissionCapabilities;
  timezone?: string | null;
  submittedRateCurrency?: string | null;
  submittedRateTerm?: string | null;
  id: string;
  tenantId: string;
  jobId: string;
  candidateId: string;
  recruiterId: string;
  recruiterJobReviewerId?: string | null;
  l1Status: string;
  l1Date: string | null;
  l2Status: string | null;
  l2Date: string | null;
  l3Status: string | null;
  l3Date: string | null;
  finalStatus: string;
  remarks: string | null;
  recruiterComment: string | null;
  submittedRate?: string | null;
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
  candidateRelevantExperience?: number | null;
  candidatePreferredLocations?: string[] | null;
  candidateSkills?: string[] | null;
  jobSkillsRequired?: string[] | null;
  jobSecondarySkills?: string[] | null;
  jobCode?: string;
  jobTitle?: string;
  clientName?: string;
  endClientName?: string;
  recruiterName?: string;
  podHeadName?: string;
  accountManagerName?: string;
  
  market?: string;
  branchId?: string | null;
}

@Injectable()
export class RecruiterSubmissionsService {
  private readonly logger = new Logger(RecruiterSubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Create a new recruiter submission
   */
  async create(
    dto: CreateSubmissionDto,
    tenantId: string,
    user?: AuthUser,
    activeBranchId?: string | null,
  ): Promise<SubmissionDetails> {
    this.logger.log(`Creating submission for Candidate ID=${dto.candidateId} against Job ID=${dto.jobId} under tenant: ${tenantId}`);

    // 1. Verify job exists and belongs to the tenant, and check if it is active
    const job = await this.prisma.job.findFirst({
      where: { id: dto.jobId, tenantId },
      select: { id: true, jobCode: true, status: true, jobTitle: true },
    });

    if (!job) {
      throw new BadRequestException(`Job with ID ${dto.jobId} not found under active tenant.`);
    }

    if (job.status?.toUpperCase() !== 'ACTIVE') {
      throw new ForbiddenException(
        `Submissions are blocked. This job is currently in '${job.status}' status and only ACTIVE jobs accept new submissions.`,
      );
    }

    // 2. Verify candidate exists and belongs to the tenant
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: dto.candidateId, tenantId },
      select: { id: true, fullName: true, firstName: true, lastName: true, email: true, currentCtc: true, expectedCtc: true, noticePeriodDays: true, relevantExperienceYears: true, preferredLocations: true },
    });

    if (!candidate) {
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
      const recruiter = await this.prisma.user.findFirst({
        where: { id: dto.recruiterId, tenantId },
        include: { customRole: { select: { systemRole: { select: { systemKey: true } } } } },
      });

      if (recruiter && recruiter.customRole?.systemRole?.systemKey === 'RECRUITER' && recruiter.podId) {
        finalStatus = 'PENDING_APPROVAL';
      }
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.recruiterSubmission.create({
        data: {
          tenantId,
          jobId: dto.jobId,
          candidateId: dto.candidateId,
          recruiterId: dto.recruiterId,
          l1Status,
          l1Date,
          l2Status,
          l2Date,
          l3Status,
          l3Date,
          finalStatus,
          remarks: dto.remarks || null,
          recruiterComment: dto.recruiterComment || null,
          submittedRateAmount: typeof dto.submittedRate === 'string' ? parseFloat(dto.submittedRate) : dto.submittedRate || null,
          candidateCurrentCtc: dto.candidateCurrentCtc ?? candidate.currentCtc,
          candidateExpectedCtc: dto.candidateExpectedCtc ?? candidate.expectedCtc,
          candidateNoticePeriod: dto.candidateNoticePeriod ?? candidate.noticePeriodDays,
          candidateRelevantExperience: dto.candidateRelevantExperience ?? candidate.relevantExperienceYears,
          candidatePreferredLocations: candidate.preferredLocations || [],
          
        },
      });

      await tx.job.update({
        where: { id: dto.jobId },
        data: { submissionDone: { increment: 1 } },
      });

      await tx.submissionEvent.create({ data: {
        tenantId, submissionId: sub.id, actorId: user?.dbId || user?.email || user?.fullName || null,
        actorName: user?.fullName || user?.email || user?.dbId || null, kind: 'CREATED', sequence: 0,
        requestId: 'created', requestHash: '', details: { snapshot: historySnapshot(sub) },
      } });
      return sub;
    }, { maxWait: 15000, timeout: 30000 });

    const candName = candidate.fullName || `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate';
    const jobInfo = job.jobCode ? `${job.jobCode} - ${job.jobTitle}` : job.jobTitle;

    // If candidate submission requires internal review, notify the pod head and account manager
    if (finalStatus === 'PENDING_APPROVAL') {
      try {
        const reviewTargets = new Set<string>();
        const recruiterUser = await this.prisma.user.findFirst({
          where: { id: dto.recruiterId, tenantId },
          select: { id: true, fullName: true, podId: true, jobReviewerId: true },
        });

        if (recruiterUser?.podId) {
          const pod = await this.prisma.pod.findUnique({
            where: { id: recruiterUser.podId },
            select: { podHeadId: true },
          });
          if (pod?.podHeadId) reviewTargets.add(pod.podHeadId);
        }

        // Notify reporting manager (jobReviewerId) if assigned to the recruiter
        if (recruiterUser?.jobReviewerId) {
          reviewTargets.add(recruiterUser.jobReviewerId);
        }

        const fullJob = await this.prisma.job.findUnique({
          where: { id: dto.jobId },
          select: { accountManagerId: true },
        });
        if (fullJob?.accountManagerId) {
          reviewTargets.add(fullJob.accountManagerId);
        }

        const targetList = Array.from(reviewTargets).filter((t) => t !== dto.recruiterId);
        if (targetList.length > 0) {
          await this.notifications.createMany(tenantId, targetList, {
            type: 'SUBMISSION_PENDING_APPROVAL',
            title: 'Candidate Submission Awaiting Review',
            message: `Recruiter ${user?.fullName || recruiterUser?.fullName || 'Staff'} submitted candidate "${candName}" for job "${jobInfo}". Internal review pending.`,
            data: {
              submissionId: submission.id,
              jobId: job.id,
              jobCode: job.jobCode,
              jobTitle: job.jobTitle,
              candidateId: candidate.id,
              candidateName: candName,
              recruiterId: dto.recruiterId,
              recruiterName: user?.fullName || recruiterUser?.fullName,
            },
            initiatorId: user?.dbId || user?.email || dto.recruiterId,
          });
        }
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch submission pending approval notification: ${err.message}`);
      }
    }

    return this.mapRowToDetails({
      ...submission,
      candidate_name: candName,
      candidate_email: candidate.email,
      job_code: job.jobCode,
      job_title: job.jobTitle,
    });
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
      candidateId?: string;
      branchId?: string;
      view?: string;
      submissionId?: string;
      search?: string;
      bucket?: TrackerBucket;
    },
  ) {
    this.logger.log(`Listing submissions for tenant: ${tenantId} under user role visibility, view=${filters.view || 'all'}`);

    let baseSql = `
      SELECT 
        s.id,
        s.tenant_id,
        s.job_id,
        s.candidate_id,
        s.recruiter_id,
        s.l1_status,
        s.l1_date,
        s.l1_remarks,
        s.l1_interviewer,
        s.l2_status,
        s.l2_date,
        s.l2_remarks,
        s.l2_interviewer,
        s.l3_status,
        s.l3_date,
        s.l3_remarks,
        s.l3_interviewer,
        s.meeting_link,
        s.final_status,
        s.remarks,
        s.recruiter_comment,
        s.pod_lead_remarks,
        s.review_feedback,
        s.submitted_rate_amount,
        s.submitted_rate_currency,
        s.submitted_rate_term,
        s.candidate_current_ctc,
        s.candidate_expected_ctc,
        s.candidate_notice_period,
        s.candidate_relevant_experience,
        s.candidate_preferred_locations,
        s.created_at,
        s.updated_at,
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
        COALESCE(s.candidate_current_ctc, c.current_ctc) AS candidate_current_ctc,
        COALESCE(s.candidate_expected_ctc, c.expected_ctc) AS candidate_expected_ctc,
        COALESCE(s.candidate_notice_period, c.notice_period_days) AS candidate_notice_period,
        COALESCE(s.candidate_relevant_experience, c.relevant_experience_years) AS candidate_relevant_experience,
        COALESCE(s.candidate_preferred_locations, c.preferred_locations) AS candidate_preferred_locations,
        c.skills AS candidate_skills,
        j.skills_required AS job_skills_required,
        j.secondary_skills AS job_secondary_skills,
        j.urgency AS job_urgency,
        j.is_co_sourced AS job_is_co_sourced,
        s.submission_number,
        COUNT(*) OVER (PARTITION BY s.job_id) AS matching_job_submission_count,
        (SELECT ev.details #>> '{changes,finalStatus,before}'
          FROM ats.submission_events ev
          WHERE ev.submission_id = s.id AND ev.tenant_id = s.tenant_id
            AND ev.details #>> '{changes,finalStatus,after}' = 'REJECTED'
          ORDER BY ev.sequence DESC LIMIT 1) AS rejection_from_status,
        j.created_at AS job_created_at,
        j.submission_required AS job_submission_required,
        j.submission_done AS job_submission_done,
        j.job_code,
        j.job_title,
        ${filters.submissionId ? `j.job_description, j.exp_min AS job_experience_min, j.exp_max AS job_experience_max,
        concat_ws(', ', j.city, j.state, j.country) AS job_location,
        j.work_mode AS job_work_mode, j.degree AS job_degree, j.notice_period AS job_notice_period,` : ''}
        cl.client_name AS client_name,
        ecl.client_name AS end_client_name,
        j.market,
        j.job_timezone AS job_timezone,
        j.branch_id AS branch_id,
        r.full_name AS recruiter_name,
        r.email AS recruiter_email,
        r.job_reviewer_id AS recruiter_job_reviewer_id,
        ph.full_name AS pod_head_name,
        COALESCE(am.full_name, am.email) AS am_name,
        am.email AS am_email,
        (SELECT cr.name
         FROM ats.custom_roles cr
         LEFT JOIN ats.custom_roles base ON base.id = cr.base_role_id AND base.tenant_id = cr.tenant_id
         LEFT JOIN ats.system_roles sr ON sr.id = COALESCE(cr.system_role_id, base.system_role_id)
         WHERE cr.tenant_id = s.tenant_id
           AND cr.business_unit_id = j.business_unit_id
           AND sr.system_key = 'ACCOUNT_MANAGER'
         ORDER BY cr.is_system ASC, cr.created_at ASC, cr.id ASC LIMIT 1) AS am_role
      FROM (SELECT rs.*, ROW_NUMBER() OVER (PARTITION BY rs.job_id ORDER BY rs.created_at ASC, rs.id ASC) AS submission_number
            FROM ats.recruiter_submissions rs WHERE rs.tenant_id = $1) s
      LEFT JOIN ats.candidates c ON s.candidate_id = c.id
      LEFT JOIN ats.jobs j ON s.job_id = j.id
      LEFT JOIN ats.clients cl ON cl.id = j.client_id
      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
      LEFT JOIN ats.users r ON s.recruiter_id = r.id
      LEFT JOIN ats.pods p ON r.pod_id = p.id
      LEFT JOIN ats.users ph ON p.pod_head_id = ph.id
      LEFT JOIN ats.users am ON (
        j.account_manager_id = am.id 


      )
      
      WHERE s.tenant_id = $1
    `;

    const params: any[] = [tenantId];
    let paramIndex = 2;

    const userPerms = user.permissions || [];
    const canViewAll =
      userPerms.includes('*') ||
      userPerms.includes('tenant:manage') ||
      userPerms.includes('tenant:settings') ||
      userPerms.includes('platform:manage') ||
      userPerms.includes('submission:view') ||
      userPerms.includes('submission:audit_rounds') ||
      userPerms.includes('submission:audit_l1') ||
      userPerms.includes('submission:audit_l2') ||
      userPerms.includes('submission:audit_l3') ||
      userPerms.includes('submission:internal_screening') ||
      userPerms.includes('submission:schedule_interview') ||
      userPerms.includes('submission:final_status') ||
      userPerms.includes('submission:approve_client');

    const view = filters.view || 'all';
    if (!['my', 'pod', 'all'].includes(view)) {
      throw new BadRequestException('Invalid submission view.');
    }
    if (!canViewAll && !userPerms.includes('submission:create')) {
      throw new ForbiddenException('Missing submission access permission.');
    }
    if (!user.dbId) throw new ForbiddenException('Missing authenticated database user.');

    if (view === 'my') {
      baseSql += ` AND s.recruiter_id = $${paramIndex}`;
      params.push(user.dbId);
      paramIndex++;
    } else if (view === 'pod') {
      if (!userPerms.includes('pod:view')) throw new ForbiddenException('Missing pod:view permission.');
      baseSql += ` AND s.recruiter_id::text IN (SELECT id::text FROM ats.users WHERE tenant_id = $1 AND pod_id = (SELECT pod_id FROM ats.users WHERE id = $${paramIndex}::uuid AND tenant_id = $1))`;
      params.push(user.dbId);
      paramIndex++;
    } else if (!canViewAll) {
      baseSql += ` AND s.recruiter_id = $${paramIndex}`;
      params.push(user.dbId);
      paramIndex++;
    }

    if (filters.submissionId) {
      baseSql += ` AND s.id = $${paramIndex}`;
      params.push(filters.submissionId);
      paramIndex++;
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
        j.branch_id = $${paramIndex} 
        OR j.branch_id IN (SELECT id FROM ats.branches WHERE LOWER(name) = LOWER($${paramIndex}) OR LOWER(code) = LOWER($${paramIndex}))

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

    if (filters.search?.trim()) {
      baseSql += ` AND (c.full_name ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex} OR j.job_code ILIKE $${paramIndex} OR j.job_title ILIKE $${paramIndex} OR cl.client_name ILIKE $${paramIndex})`;
      params.push(`%${filters.search.trim().replace(/[\\%_]/g, '\\$&')}%`);
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

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(Math.max(1, filters.limit || 20), 100);
    const offset = (page - 1) * limit;

    const bucketConditions = trackerBucketConditions();
    const bucket = filters.bucket || 'all';
    if (!Object.prototype.hasOwnProperty.call(bucketConditions, bucket)) throw new BadRequestException('Invalid tracker filter.');
    const countSql = `SELECT COUNT(*) FILTER (WHERE ${bucketConditions[bucket]}) as count,
      COUNT(*) as all_count,
      COUNT(*) FILTER (WHERE ${bucketConditions.review}) as review_count,
      COUNT(*) FILTER (WHERE ${bucketConditions.interviews}) as interviews_count,
      COUNT(*) FILTER (WHERE ${bucketConditions.offers}) as offers_count,
      COUNT(*) FILTER (WHERE ${bucketConditions.closed}) as closed_count,
      MIN(am_role) AS min_am_role, MAX(am_role) AS max_am_role,
      COUNT(*) FILTER (WHERE am_role IS NULL) AS missing_am_role_count,
      COUNT(*) FILTER (WHERE l1_status = 'PENDING') as l1_pending,
      COUNT(*) FILTER (WHERE l2_status = 'PENDING') as l2_pending,
      COUNT(*) FILTER (WHERE l3_status = 'PENDING') as l3_pending
      FROM (${baseSql}) AS counted`;
    const retrieveSql = `${baseSql} AND ${trackerBucketConditions('s.')[bucket]} ORDER BY s.created_at DESC, s.id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const retrieveParams = [...params, limit, offset];

    try {
      const [countRes, retrieveRes]: [any, any] = await Promise.all([
        this.prisma.$queryRawUnsafe(countSql, ...params),
        this.prisma.$queryRawUnsafe(retrieveSql, ...retrieveParams),
      ]);

      const total = Number(countRes[0]?.count || 0);
      const data = (retrieveRes || []).map((row: any) => ({ ...this.mapRowToDetails(row), capabilities: submissionCapabilities(user.permissions) }));

      return {
        data,
        accountManagerLabel: Number(countRes[0]?.missing_am_role_count || 0) === 0 && countRes[0]?.min_am_role === countRes[0]?.max_am_role ? countRes[0]?.min_am_role || 'Created by' : 'Created by',
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        counts: {
          all: Number(countRes[0]?.all_count || 0),
          review: Number(countRes[0]?.review_count || 0),
          interviews: Number(countRes[0]?.interviews_count || 0),
          offers: Number(countRes[0]?.offers_count || 0),
          closed: Number(countRes[0]?.closed_count || 0),
        },
        stats: {
          total,
          l1Pending: Number(countRes[0]?.l1_pending || 0),
          l2Pending: Number(countRes[0]?.l2_pending || 0),
          l3Pending: Number(countRes[0]?.l3_pending || 0),
        },
      };
    } catch (err: any) {
      this.logger.error(`Failed to retrieve submissions: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Find a single recruiter submission by ID
   */
  async findOne(id: string, tenantId: string, user?: AuthUser, branchId?: string | null): Promise<SubmissionDetails> {
    if (user) {
      const result = await this.findAll(tenantId, user, { submissionId: id, branchId: branchId || undefined, limit: 1 });
      if (!result.data.length) throw new NotFoundException('Submission not found in your accessible workspace.');
      return result.data[0];
    }
    this.logger.log(`Fetching submission ID=${id} for tenant: ${tenantId}`);

    const sql = `
      SELECT 
        s.id,
        s.tenant_id,
        s.job_id,
        s.candidate_id,
        s.recruiter_id,
        s.l1_status,
        s.l1_date,
        s.l1_remarks,
        s.l1_interviewer,
        s.l2_status,
        s.l2_date,
        s.l2_remarks,
        s.l2_interviewer,
        s.l3_status,
        s.l3_date,
        s.l3_remarks,
        s.l3_interviewer,
        s.meeting_link,
        s.final_status,
        s.remarks,
        s.recruiter_comment,
        s.pod_lead_remarks,
        s.review_feedback,
        s.submitted_rate_amount,
        s.submitted_rate_currency,
        s.submitted_rate_term,
        s.candidate_current_ctc,
        s.candidate_expected_ctc,
        s.candidate_notice_period,
        s.candidate_relevant_experience,
        s.candidate_preferred_locations,
        s.created_at,
        s.updated_at,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.raw_current_location AS candidate_current_location,
        c.total_experience_years AS candidate_experience,
        c.raw_current_designation AS candidate_designation,
        c.work_authorization AS candidate_work_auth,
        c.source AS candidate_source,
        COALESCE(s.candidate_current_ctc, c.current_ctc) AS candidate_current_ctc,
        COALESCE(s.candidate_expected_ctc, c.expected_ctc) AS candidate_expected_ctc,
        COALESCE(s.candidate_notice_period, c.notice_period_days) AS candidate_notice_period,
        COALESCE(s.candidate_relevant_experience, c.relevant_experience_years) AS candidate_relevant_experience,
        COALESCE(s.candidate_preferred_locations, c.preferred_locations) AS candidate_preferred_locations,
        c.skills AS candidate_skills,
        j.skills_required AS job_skills_required,
        j.secondary_skills AS job_secondary_skills,
        (SELECT ev.details #>> '{changes,finalStatus,before}'
          FROM ats.submission_events ev
          WHERE ev.submission_id = s.id AND ev.tenant_id = s.tenant_id
            AND ev.details #>> '{changes,finalStatus,after}' = 'REJECTED'
          ORDER BY ev.sequence DESC LIMIT 1) AS rejection_from_status,
        j.created_at AS job_created_at,
        j.submission_required AS job_submission_required,
        j.submission_done AS job_submission_done,
        j.job_code,
        j.job_title,
        j.job_description, j.exp_min AS job_experience_min, j.exp_max AS job_experience_max,
        concat_ws(', ', j.city, j.state, j.country) AS job_location,
        j.work_mode AS job_work_mode, j.degree AS job_degree, j.notice_period AS job_notice_period,
        cl.client_name AS client_name,
        ecl.client_name AS end_client_name,
        j.market,
        j.branch_id AS branch_id,
        r.full_name AS recruiter_name,
        r.email AS recruiter_email,
        ph.full_name AS pod_head_name,
        COALESCE(am.full_name, am.email) AS am_name,
        am.email AS am_email,
        (SELECT cr.name
         FROM ats.custom_roles cr
         LEFT JOIN ats.custom_roles base ON base.id = cr.base_role_id AND base.tenant_id = cr.tenant_id
         LEFT JOIN ats.system_roles sr ON sr.id = COALESCE(cr.system_role_id, base.system_role_id)
         WHERE cr.tenant_id = s.tenant_id
           AND cr.business_unit_id = j.business_unit_id
           AND sr.system_key = 'ACCOUNT_MANAGER'
         ORDER BY cr.is_system ASC, cr.created_at ASC, cr.id ASC LIMIT 1) AS am_role
      FROM ats.recruiter_submissions s
      LEFT JOIN ats.candidates c ON s.candidate_id = c.id
      LEFT JOIN ats.jobs j ON s.job_id = j.id
      LEFT JOIN ats.clients cl ON cl.id = j.client_id
      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
      LEFT JOIN ats.users r ON s.recruiter_id = r.id
      LEFT JOIN ats.pods p ON r.pod_id = p.id
      LEFT JOIN ats.users ph ON p.pod_head_id = ph.id
      LEFT JOIN ats.users am ON (
        j.account_manager_id = am.id 


      )
      
      WHERE s.id = $1 AND s.tenant_id = $2
      LIMIT 1
    `;

    const res: any = await this.prisma.$queryRawUnsafe(sql, id, tenantId);
    if (!res || res.length === 0) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    return this.mapRowToDetails(res[0]);
  }

  /**
   * Update submission statuses with auto-rejection logic
   */
  async history(id: string, tenantId: string, user: AuthUser, branchId?: string | null, page = 1) {
    const current = await this.findOne(id, tenantId, user, branchId);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('Invalid history page.');
    const where = { submissionId: id, tenantId };
    const total = await this.prisma.submissionEvent.count({ where });
    if (!total) return { data: [{ id: 'legacy-baseline', kind: 'BASELINE', actorName: null, createdAt: current.updatedAt,
      details: { snapshot: historySnapshot(current) } }], page: 1, total: 1, totalPages: 1 };
    const data = await this.prisma.submissionEvent.findMany({ where, orderBy: { sequence: 'asc' }, skip: (page - 1) * 25, take: 25 });
    return { data, page, total, totalPages: Math.ceil(total / 25) };
  }

  async assessment(id: string, tenantId: string, user: AuthUser, branchId?: string | null) {
    const submission = await this.findOne(id, tenantId, user, branchId);
    if (!submission.capabilities?.review) throw new ForbiddenException('Internal review permission is required.');
    return { submission, assessment: await this.assessSubmission(this.prisma, submission, tenantId) };
  }

  private async assessSubmission(db: any, submission: { jobId: string; candidateId: string }, tenantId: string) {
    const [job, candidate] = await Promise.all([
      db.job.findFirst({ where: { id: submission.jobId, tenantId }, select: {
        id: true, updatedAt: true, skillsRequired: true, secondarySkills: true, jobDescription: true,
        expMin: true, expMax: true, city: true, state: true, country: true, workMode: true, degree: true, noticePeriod: true,
      } }),
      db.candidate.findFirst({ where: { id: submission.candidateId, tenantId, deletedAt: null }, select: {
        id: true, updatedAt: true, skills: true, totalExperienceYears: true, rawCurrentLocation: true,
        preferredLocations: true, noticePeriodDays: true, resumeRecord: { select: { id: true, fileHash: true, rawText: true, parsedJson: true } },
      } }),
    ]);
    if (!job || !candidate) throw new NotFoundException('Assessment sources are unavailable in this tenant.');
    return assessCandidate(job, { ...candidate, rawText: candidate.resumeRecord?.rawText, parsedJson: candidate.resumeRecord?.parsedJson });
  }

  async update(id: string, dto: UpdateSubmissionDto, tenantId: string, user: AuthUser, branchId?: string | null): Promise<SubmissionDetails> {
    await this.findOne(id, tenantId, user, branchId);
    this.logger.log(`Updating submission ID=${id} for tenant: ${tenantId}`);

    const existing = await this.prisma.recruiterSubmission.findFirst({
      where: { id, tenantId },
      include: {
        job: { select: { id: true, jobCode: true, jobTitle: true, accountManagerId: true } },
        candidate: { select: { id: true, fullName: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    const requestHash = saveRequestHash(dto);
    if (dto.requestId) {
      const prior = await this.prisma.submissionEvent.findFirst({ where: { submissionId: id, tenantId, requestId: dto.requestId } });
      if (prior) {
        if (prior.requestHash !== requestHash || prior.actorId !== (user.dbId || user.email || user.fullName || null)) throw new ConflictException('This request ID has already been used for another save.');
        return this.findOne(id, tenantId, user, branchId);
      }
    }
    const caps = submissionCapabilities(user.permissions);
    validateTrackerUpdate(existing, dto, caps);
    if (dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
      throw new ConflictException('This submission was updated by someone else. Reload it before saving.');
    }

    const mergedL1Status = dto.l1Status !== undefined ? dto.l1Status : existing.l1Status;
    const mergedL2Status = dto.l2Status !== undefined ? dto.l2Status : existing.l2Status;
    const mergedL3Status = dto.l3Status !== undefined ? dto.l3Status : existing.l3Status;

    let finalStatus = dto.finalStatus !== undefined ? dto.finalStatus : existing.finalStatus;
    let l1Status = mergedL1Status;
    let l2Status = mergedL2Status;
    let l3Status = mergedL3Status;

    let l1Date = dto.l1Date !== undefined ? (dto.l1Date ? new Date(dto.l1Date) : null) : existing.l1Date;
    let l2Date = dto.l2Date !== undefined ? (dto.l2Date ? new Date(dto.l2Date) : null) : existing.l2Date;
    let l3Date = dto.l3Date !== undefined ? (dto.l3Date ? new Date(dto.l3Date) : null) : existing.l3Date;

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

    const data: any = {
      l1Status,
      l1Date,
      l2Status,
      l2Date,
      l3Status,
      l3Date,
      finalStatus,
    };

    if (dto.jobId !== undefined) data.jobId = dto.jobId;
    if (dto.candidateId !== undefined) data.candidateId = dto.candidateId;
    if (dto.recruiterId !== undefined) data.recruiterId = dto.recruiterId;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    if (dto.recruiterComment !== undefined) data.recruiterComment = dto.recruiterComment;
    if (dto.submittedRate !== undefined) data.submittedRateAmount = typeof dto.submittedRate === 'string' ? parseFloat(dto.submittedRate) : dto.submittedRate;
    if (dto.candidateCurrentCtc !== undefined) data.candidateCurrentCtc = dto.candidateCurrentCtc;
    if (dto.candidateExpectedCtc !== undefined) data.candidateExpectedCtc = dto.candidateExpectedCtc;
    if (dto.candidateNoticePeriod !== undefined) data.candidateNoticePeriod = dto.candidateNoticePeriod;
    if (dto.candidateRelevantExperience !== undefined) data.candidateRelevantExperience = dto.candidateRelevantExperience;
    
    if (dto.podLeadRemarks !== undefined) data.podLeadRemarks = dto.podLeadRemarks;
    if (dto.reviewFeedback !== undefined) {
      data.reviewFeedback = dto.reviewFeedback;
      if (dto.podLeadRemarks === undefined) {
        data.podLeadRemarks = dto.reviewFeedback;
      }
    }
    if (dto.l1Remarks !== undefined) data.l1Remarks = dto.l1Remarks;
    if (dto.l1Interviewer !== undefined) data.l1Interviewer = dto.l1Interviewer;
    if (dto.l2Remarks !== undefined) data.l2Remarks = dto.l2Remarks;
    if (dto.l2Interviewer !== undefined) data.l2Interviewer = dto.l2Interviewer;
    if (dto.l3Remarks !== undefined) data.l3Remarks = dto.l3Remarks;
    if (dto.l3Interviewer !== undefined) data.l3Interviewer = dto.l3Interviewer;
    if (dto.meetingLink !== undefined) data.meetingLink = dto.meetingLink;
    if (l1Status === 'REJECTED') {
      data.l2Remarks = null; data.l2Interviewer = null; data.l3Remarks = null; data.l3Interviewer = null;
    } else if (l2Status === 'REJECTED') {
      data.l3Remarks = null; data.l3Interviewer = null;
    }

    if (!Object.keys(historyChanges(existing, data)).length && !dto.bypassReason?.trim()) return this.findOne(id, tenantId, user, branchId);

    // Atomic compare-and-set, including legacy callers without an explicit version.
    // PostgreSQL default timestamps can have microseconds; compare the read millisecond.
    const version = existing.updatedAt.getTime();
    data.updatedAt = new Date(Math.max(Date.now(), version + 1));
    await this.prisma.$transaction(async tx => {
      const assessment = dto.assessmentVersion ? await this.assessSubmission(tx, existing, tenantId) : null;
      if (assessment && assessment.version !== dto.assessmentVersion) throw new ConflictException('The job or candidate evidence changed. Reload the assessment before deciding.');
      if (assessment && Object.keys(dto.reviewOverrides || {}).some(key => !assessment.criteria.some(row => row.key === key))) throw new BadRequestException('Reviewer override refers to an unknown requirement.');
      const saved = await tx.recruiterSubmission.updateMany({
        where: { id, tenantId, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } }, data,
      });
      if (saved.count !== 1) throw new ConflictException('This submission changed while saving. Reload it and try again.');
      const hasHistory = await tx.submissionEvent.findFirst({ where: { submissionId: id, tenantId }, select: { sequence: true }, orderBy: { sequence: 'desc' } });
      if (!hasHistory) await tx.submissionEvent.create({ data: {
        tenantId, submissionId: id, kind: 'BASELINE', sequence: 0, requestId: 'baseline', requestHash: '',
        details: { snapshot: historySnapshot(existing) },
      } });
      await tx.submissionEvent.create({ data: {
        tenantId, submissionId: id, actorId: user.dbId || user.email || user.fullName || null,
        actorName: user.fullName || user.email || user.dbId || null,
        kind: 'UPDATE', sequence: (hasHistory?.sequence ?? 0) + 1, requestId: dto.requestId || randomUUID(), requestHash,
        details: JSON.parse(JSON.stringify({ changes: historyChanges(existing, data), ...(assessment ? { assessment, reviewOverrides: dto.reviewOverrides || {} } : {}), ...(dto.bypassReason ? { bypassReason: dto.bypassReason.trim() } : {}) })),
      } });
    });

    // ── Candidate Submission Notification Dispatch ──────────────────────────────
    const candName =
      (existing as any).candidate?.fullName ||
      `${(existing as any).candidate?.firstName || ''} ${(existing as any).candidate?.lastName || ''}`.trim() ||
      'Candidate';
    const jobCode = (existing as any).job?.jobCode || '';
    const jobTitle = (existing as any).job?.jobTitle || '';
    const jobDisplay = jobCode ? `${jobCode} - ${jobTitle}` : jobTitle;
    const approverName = user?.fullName || user?.email || 'Approver';
    const feedbackNote = (
      data.reviewFeedback ||
      data.podLeadRemarks ||
      data.remarks ||
      dto.reviewFeedback ||
      dto.podLeadRemarks ||
      dto.remarks ||
      ''
    ).trim();

    const wasPending = existing.finalStatus === 'PENDING_APPROVAL';
    const isNowApproved = wasPending && (finalStatus === 'SUBMITTED' || finalStatus === 'POD_APPROVED');
    const isNowRejected = wasPending && finalStatus === 'REJECTED';

    const targetRecruiter = existing.recruiterId;

    if (targetRecruiter) {
      try {
        if (isNowApproved) {
          // 1. Candidate Submission Approved by Pod Lead / Account Manager
          await this.notifications.create(tenantId, targetRecruiter, {
            type: 'SUBMISSION_APPROVED',
            title: 'Candidate Submission Approved',
            message: `Your submission for candidate "${candName}" on job "${jobDisplay}" has been approved by ${approverName} and submitted to the client.${feedbackNote ? ` Remarks: "${feedbackNote}"` : ''}`,
            data: {
              submissionId: id,
              jobId: existing.jobId,
              jobCode,
              jobTitle,
              candidateId: existing.candidateId,
              candidateName: candName,
              status: 'SUBMITTED',
              approverName,
              reviewFeedback: feedbackNote || undefined,
            },
            initiatorId: user.dbId || user.email || 'System',
          });
        } else if (isNowRejected) {
          // 2. Candidate Submission Rejected during Internal Screening
          await this.notifications.create(tenantId, targetRecruiter, {
            type: 'SUBMISSION_REJECTED',
            title: 'Candidate Submission Not Approved',
            message: `Your submission for candidate "${candName}" on job "${jobDisplay}" was rejected during internal review by ${approverName}.${feedbackNote ? ` Reason: "${feedbackNote}"` : ''}`,
            data: {
              submissionId: id,
              jobId: existing.jobId,
              jobCode,
              jobTitle,
              candidateId: existing.candidateId,
              candidateName: candName,
              status: 'REJECTED',
              approverName,
              reviewFeedback: feedbackNote || undefined,
            },
            initiatorId: user.dbId || user.email || 'System',
          });
        } else if (existing.finalStatus !== 'OFFER' && finalStatus === 'OFFER') {
          // 3. Offer stage reached
          await this.notifications.create(tenantId, targetRecruiter, {
            type: 'SUBMISSION_OFFER',
            title: 'Offer Extended to Candidate',
            message: `Candidate "${candName}" has received an offer for job "${jobDisplay}"!`,
            data: {
              submissionId: id,
              jobId: existing.jobId,
              jobCode,
              jobTitle,
              candidateId: existing.candidateId,
              candidateName: candName,
              status: 'OFFER',
              approverName,
            },
            initiatorId: user.dbId || user.email || 'System',
          });
        } else if (existing.finalStatus !== 'JOIN' && (finalStatus === 'JOIN' || finalStatus === 'PLACED')) {
          // 4. Joined / Placed
          await this.notifications.create(tenantId, targetRecruiter, {
            type: 'SUBMISSION_PLACED',
            title: 'Candidate Placed / Joined!',
            message: `Congratulations! Candidate "${candName}" has joined for job "${jobDisplay}"!`,
            data: {
              submissionId: id,
              jobId: existing.jobId,
              jobCode,
              jobTitle,
              candidateId: existing.candidateId,
              candidateName: candName,
              status: finalStatus,
              approverName,
            },
            initiatorId: user.dbId || user.email || 'System',
          });
        } else if (!wasPending && existing.finalStatus !== 'REJECTED' && finalStatus === 'REJECTED') {
          // 5. Client Rejection
          await this.notifications.create(tenantId, targetRecruiter, {
            type: 'SUBMISSION_REJECTED',
            title: 'Candidate Rejected by Client',
            message: `Candidate "${candName}" was marked as rejected for job "${jobDisplay}".${feedbackNote ? ` Note: "${feedbackNote}"` : ''}`,
            data: {
              submissionId: id,
              jobId: existing.jobId,
              jobCode,
              jobTitle,
              candidateId: existing.candidateId,
              candidateName: candName,
              status: 'REJECTED',
            },
            initiatorId: user.dbId || user.email || 'System',
          });
        } else {
          // 6. Check interview schedule changes
          const newlyScheduledRound =
            (existing.l1Status !== 'SCHEDULED' && l1Status === 'SCHEDULED') ? 'L1' :
            (existing.l2Status !== 'SCHEDULED' && l2Status === 'SCHEDULED') ? 'L2' :
            (existing.l3Status !== 'SCHEDULED' && l3Status === 'SCHEDULED') ? 'L3' : null;

          if (newlyScheduledRound) {
            const roundDate = newlyScheduledRound === 'L1' ? l1Date : newlyScheduledRound === 'L2' ? l2Date : l3Date;
            const dateStr = roundDate ? ` on ${new Date(roundDate).toLocaleDateString()}` : '';
            await this.notifications.create(tenantId, targetRecruiter, {
              type: 'INTERVIEW_SCHEDULED',
              title: `${newlyScheduledRound} Interview Scheduled`,
              message: `${newlyScheduledRound} interview scheduled for candidate "${candName}" on job "${jobDisplay}"${dateStr}.`,
              data: {
                submissionId: id,
                jobId: existing.jobId,
                jobCode,
                jobTitle,
                candidateId: existing.candidateId,
                candidateName: candName,
                round: newlyScheduledRound,
                meetingLink: data.meetingLink || existing.meetingLink || undefined,
              },
              initiatorId: user.dbId || user.email || 'System',
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch submission notification: ${err.message}`, err.stack);
      }
    }

    return this.findOne(id, tenantId, user, branchId);
  }

  /**
   * Delete a recruiter submission, scoped by tenant
   */
  async remove(id: string, tenantId: string): Promise<{ message: string }> {
    this.logger.log(`Removing submission ID=${id} for tenant: ${tenantId}`);

    const existing = await this.prisma.recruiterSubmission.findFirst({
      where: { id, tenantId },
      select: { id: true, jobId: true },
    });

    if (!existing) {
      throw new NotFoundException(`Recruiter submission with ID ${id} was not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.recruiterSubmission.delete({
        where: { id },
      });

      await tx.job.update({
        where: { id: existing.jobId },
        data: {
          submissionDone: {
            decrement: 1,
          },
        },
      });
    }, { maxWait: 15000, timeout: 30000 });

    return { message: `Recruiter submission with ID ${id} was deleted successfully.` };
  }

  /**
   * Retrieve aggregate status counts for recruiter tracker, scoped by tenant
   */
  async getTrackerStats(tenantId: string, user: AuthUser, filters: { view?: string; branchId?: string } = {}) {
    const result = await this.findAll(tenantId, user, { ...filters, limit: 1 });
    return result.stats;
  }

  /**
   * Helper mapping from PG row to details object
   */
  private mapRowToDetails(row: any): SubmissionDetails {
    return {
      rejectionFromStatus: row.rejection_from_status ?? null,
      currentRoundKey: currentTrackerRound(row),
      id: row.id,
      tenantId: row.tenant_id || row.tenantId,
      jobId: row.job_id || row.jobId,
      candidateId: row.candidate_id || row.candidateId,
      recruiterId: row.recruiter_id || row.recruiterId,
      recruiterJobReviewerId: row.recruiter_job_reviewer_id || row.recruiterJobReviewerId || null,
      l1Status: row.l1_status || row.l1Status,
      l1Date: row.l1_date || row.l1Date ? new Date(row.l1_date || row.l1Date).toISOString() : null,
      l2Status: row.l2_status || row.l2Status,
      l2Date: row.l2_date || row.l2Date ? new Date(row.l2_date || row.l2Date).toISOString() : null,
      l3Status: row.l3_status || row.l3Status,
      l3Date: row.l3_date || row.l3Date ? new Date(row.l3_date || row.l3Date).toISOString() : null,
      finalStatus: row.final_status || row.finalStatus,
      remarks: row.remarks,
      recruiterComment: row.recruiter_comment || row.recruiterComment,
      submittedRate: row.submitted_rate_amount != null ? String(row.submitted_rate_amount) : row.submitted_rate || row.submittedRate || null,
      submittedRateCurrency: row.submitted_rate_currency || null,
      submittedRateTerm: row.submitted_rate_term || null,
      timezone: row.job_timezone || null,
      podLeadRemarks: row.pod_lead_remarks || row.podLeadRemarks || row.review_feedback || row.reviewFeedback || null,
      reviewFeedback: row.review_feedback || row.reviewFeedback || row.pod_lead_remarks || row.podLeadRemarks || null,
      l1Remarks: row.l1_remarks || row.l1Remarks || null,
      l1Interviewer: row.l1_interviewer || row.l1Interviewer || null,
      l2Remarks: row.l2_remarks || row.l2Remarks || null,
      l2Interviewer: row.l2_interviewer || row.l2Interviewer || null,
      l3Remarks: row.l3_remarks || row.l3Remarks || null,
      l3Interviewer: row.l3_interviewer || row.l3Interviewer || null,
      meetingLink: row.meeting_link || row.meetingLink || null,
      createdAt: row.created_at || row.createdAt ? new Date(row.created_at || row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at || row.updatedAt ? new Date(row.updated_at || row.updatedAt).toISOString() : new Date().toISOString(),

      candidateName: row.candidate_name || row.candidateName,
      candidateEmail: row.candidate_email || row.candidateEmail,
      candidatePhone: row.candidate_phone || row.candidatePhone,
      candidateCurrentLocation: row.candidate_current_location || row.candidateCurrentLocation,
      candidateExperience: row.candidate_experience ?? row.candidateExperience,
      candidateDesignation: row.candidate_designation || row.candidateDesignation,
      candidateWorkAuth: row.candidate_work_auth || row.candidateWorkAuth,
      candidateSource: row.candidate_source || row.candidateSource,
      candidateCurrentCtc: row.candidate_current_ctc || row.candidateCurrentCtc,
      candidateExpectedCtc: row.candidate_expected_ctc || row.candidateExpectedCtc,
      candidateNoticePeriod: row.candidate_notice_period ?? row.candidateNoticePeriod ?? null,
      candidateRelevantExperience: row.candidate_relevant_experience !== undefined ? Number(row.candidate_relevant_experience) : null,
      candidatePreferredLocations: row.candidate_preferred_locations || null,
      candidateSkills: row.candidate_skills || null,
      jobDescription: row.job_description ?? null,
      jobExperienceMin: row.job_experience_min ?? null,
      jobExperienceMax: row.job_experience_max ?? null,
      jobLocation: row.job_location || null,
      jobWorkMode: row.job_work_mode ?? null,
      jobDegree: row.job_degree ?? null,
      jobNoticePeriod: row.job_notice_period ?? null,
      jobSkillsRequired: row.job_skills_required || null,
      jobSecondarySkills: row.job_secondary_skills || null,
      jobUrgency: row.job_urgency ?? null,
      jobIsCoSourced: Boolean(row.job_is_co_sourced),
      submissionNumber: row.submission_number ? Number(row.submission_number) : null,
      matchingJobSubmissionCount: Number(row.matching_job_submission_count || 1),
      jobCreatedAt: row.job_created_at ? new Date(row.job_created_at).toISOString() : null,
      jobSubmissionRequired: row.job_submission_required ?? null,
      jobSubmissionDone: row.job_submission_done ?? null,
      accountManagerRole: row.am_role || null,
      accountManagerEmail: row.am_email || null,
      jobCode: row.job_code || row.jobCode,
      jobTitle: row.job_title || row.jobTitle,
      clientName: row.client_name || row.client?.clientName,
      endClientName: row.end_client_name || row.end_client?.clientName,
      recruiterName: row.recruiter_name || row.recruiterName,
      recruiterEmail: row.recruiter_email || row.recruiterEmail || null,
      podHeadName: row.pod_head_name || row.podHeadName,
      accountManagerName: row.am_name || row.accountManagerName,
      
      market: row.market,
      branchId: row.branch_id || row.branchId || null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Tenant & Branch Custom Stage Remarks Configuration Methods
  // ─────────────────────────────────────────────────────────────
  async getCustomRemarks(tenantId: string, branchId?: string, includeGlobal?: boolean) {
    let shouldIncludeGlobal = includeGlobal;
    let resolvedBranchId = branchId?.trim();
    let selectedGlobalRemarkIds: number[] | 'ALL' | null = null;

    if (resolvedBranchId && resolvedBranchId !== 'null' && resolvedBranchId !== 'undefined') {
      try {
        const branch: any = await this.prisma.branch.findFirst({
          where: {
            tenantId,
            OR: [
              { id: resolvedBranchId },
              { name: { equals: resolvedBranchId, mode: 'insensitive' } },
              { code: { equals: resolvedBranchId, mode: 'insensitive' } },
            ],
          },
          select: { id: true, enableGlobalRemarks: true, selectedGlobalRemarkIds: true },
        });
        if (branch) {
          resolvedBranchId = branch.id;
          if (shouldIncludeGlobal === undefined) {
            shouldIncludeGlobal = Boolean(branch.enableGlobalRemarks);
          }
          if (branch.selectedGlobalRemarkIds) {
            if (branch.selectedGlobalRemarkIds === 'ALL') {
              selectedGlobalRemarkIds = 'ALL';
            } else {
              try {
                const parsed = JSON.parse(branch.selectedGlobalRemarkIds);
                if (Array.isArray(parsed)) {
                  selectedGlobalRemarkIds = parsed.map((n: any) => parseInt(n, 10)).filter((n: number) => !isNaN(n));
                }
              } catch {
                selectedGlobalRemarkIds = 'ALL';
              }
            }
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

    try {
      let query = `
        SELECT id, stage, remark_text as "remarkText", 
               COALESCE(remark_type, 'GENERAL') as "remarkType",
               branch_id as "branchId", 
               COALESCE(is_global, branch_id IS NULL) as "isGlobal",
               created_by as "createdBy", created_at as "createdAt"
        FROM ats.tenant_stage_remarks
      `;
      const params: any[] = [];

      if (resolvedBranchId) {
        params.push(tenantId, resolvedBranchId);
        if (shouldIncludeGlobal) {
          if (selectedGlobalRemarkIds && Array.isArray(selectedGlobalRemarkIds) && selectedGlobalRemarkIds.length > 0) {
            const idList = selectedGlobalRemarkIds.join(',');
            query += ` WHERE (tenant_id = $1 AND branch_id = $2) OR ((branch_id IS NULL OR is_global = TRUE) AND id IN (${idList}))`;
          } else if (selectedGlobalRemarkIds && Array.isArray(selectedGlobalRemarkIds) && selectedGlobalRemarkIds.length === 0) {
            query += ` WHERE tenant_id = $1 AND branch_id = $2`;
          } else {
            query += ` WHERE (tenant_id = $1 AND branch_id = $2) OR (branch_id IS NULL OR is_global = TRUE)`;
          }
        } else {
          // Strictly branch-specific remarks only! Zero global remarks!
          query += ` WHERE tenant_id = $1 AND branch_id = $2`;
        }
      } else if (includeGlobal === true) {
        // Universal global templates query across all tenants (used by /utility/global-remarks and branch global picker)
        query += ` WHERE (branch_id IS NULL OR is_global = TRUE)`;
      } else {
        params.push(tenantId);
        query += ` WHERE tenant_id = $1 OR (branch_id IS NULL OR is_global = TRUE)`;
      }
      query += ` ORDER BY id ASC`;

      const rows: any = await this.prisma.$queryRawUnsafe(query, ...params);
      return rows || [];
    } catch {
      return [];
    }
  }

  async createCustomRemark(
    tenantId: string,
    stage: string,
    remarkText: string,
    remarkType: string = 'GENERAL',
    branchId?: string,
    createdBy?: string,
    isGlobal?: boolean,
    user?: AuthUser,
  ) {
    if (!stage || !remarkText?.trim()) {
      throw new BadRequestException('Stage and remarkText are required.');
    }
    const cleanStage = stage.toLowerCase().trim();
    const cleanType = (remarkType || 'GENERAL').toUpperCase().trim();
    const cleanBranchId = branchId?.trim() || null;
    const cleanIsGlobal = Boolean(isGlobal || !cleanBranchId);

    if (!cleanIsGlobal) {
      const permissions = user?.permissions || [];
      const tenantManager = permissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
      if (!tenantManager && (!permissions.some(p => ['branch:edit', 'branch_admin:manage'].includes(p)) || user?.branchId !== cleanBranchId)) {
        throw new ForbiddenException('You can only manage remarks for your assigned branch.');
      }
      const branch = await this.prisma.branch.findFirst({ where: { id: cleanBranchId!, tenantId }, select: { id: true } });
      if (!branch) throw new NotFoundException('Branch not found.');
    }

    if (cleanIsGlobal) {
      const isGlobalAdmin =
        user?.permissions?.some(p => ['system:admin', 'platform:manage'].includes(p));
      if (!isGlobalAdmin) {
        throw new ForbiddenException(
          'Access denied. Universal global remark templates can only be created by a Global Administrator (SUPER_ADMIN).',
        );
      }
    }

    const rawRemarks = remarkText.split(/[\n,]+/).map((r) => r.trim()).filter(Boolean);
    const results: any[] = [];

    for (const text of rawRemarks.length > 0 ? rawRemarks : [remarkText.trim()]) {
      const rows: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO ats.tenant_stage_remarks (tenant_id, stage, remark_text, remark_type, branch_id, is_global, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, stage, remark_text as "remarkText", remark_type as "remarkType", branch_id as "branchId", is_global as "isGlobal", created_by as "createdBy", created_at as "createdAt"`,
        tenantId,
        cleanStage,
        text,
        cleanType,
        cleanBranchId,
        cleanIsGlobal,
        createdBy || 'admin',
      );
      if (rows && rows.length > 0) {
        results.push(rows[0]);
      }
    }

    return results.length === 1 ? results[0] : results;
  }

  async deleteCustomRemark(tenantId: string, id: number, user?: AuthUser) {
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      throw new BadRequestException('Template ID must be a positive integer.');
    }
    const existing: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, tenant_id, is_global, branch_id FROM ats.tenant_stage_remarks WHERE id = $1`,
      id,
    );
    if (!existing || existing.length === 0) {
      throw new NotFoundException(`Custom remark template #${id} not found.`);
    }

    const remark = existing[0];
    const isGlobal = Boolean(remark.is_global) || remark.branch_id === null;

    if (isGlobal) {
      const isGlobalAdmin =
        user?.permissions?.some(p => ['system:admin', 'platform:manage'].includes(p));

      if (!isGlobalAdmin) {
        throw new ForbiddenException(
          'Access denied. Global remarks templates can only be deleted by a Global Administrator (SUPER_ADMIN). Tenant administrators cannot delete global remarks.',
        );
      }
    } else {
      const permissions = user?.permissions || [];
      const tenantManager = permissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
      if (!tenantManager && (!permissions.some(p => ['branch:edit', 'branch_admin:manage'].includes(p)) || user?.branchId !== remark.branch_id)) {
        throw new ForbiddenException('You can only manage remarks for your assigned branch.');
      }
      if (remark.tenant_id && remark.tenant_id !== tenantId) {
        throw new ForbiddenException('Access denied. You cannot delete remarks belonging to another tenant.');
      }
    }

    await this.prisma.$queryRawUnsafe(
      `DELETE FROM ats.tenant_stage_remarks WHERE id = $1`,
      id,
    );
    return { message: `Custom remark #${id} deleted successfully.`, id };
  }
}
