const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { JobsService } = require('./dist/jobs/jobs.service.js'); // Assuming compiled JS exists

async function test() {
  try {
    const id = '1e14a993-4d25-4d08-ac8d-f6135e94f95f';
    const sql = `SELECT j.*, rm.full_name AS recruitment_manager_name, 
                app.full_name AS assigned_approver_name,
                COALESCE(pod_info.pod_id, '') AS pod_id, COALESCE(pod_info.pod_name, '') AS pod_name,
               COALESCE(recruiter_info.recruiter_ids, '') AS recruiter_ids,
               COALESCE(recruiter_info.recruiter_names, '') AS multi_recruiter_names,
                uc.full_name AS creator_name, uc.email AS creator_email,
                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name
         FROM ats.jobs j
         LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
         
         LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
        LEFT JOIN (
          SELECT 
            jr.job_id,
            STRING_AGG(u.id::text, ',') AS recruiter_ids,
            STRING_AGG(u.full_name, ', ') AS recruiter_names
          FROM ats.job_recruiters jr
          JOIN ats.users u ON u.id = jr.recruiter_id
          GROUP BY jr.job_id
        ) recruiter_info ON recruiter_info.job_id = j.id
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
         WHERE j.id = '${id}'::uuid AND j.deleted_at IS NULL LIMIT 1`;
    const res = await prisma.$queryRawUnsafe(sql);
    const row = res[0];
    
    // Test mapping manually just in case
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

    console.log("Checking mappings...");
    const profile = {
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
              recruiter: row.multi_recruiter_names || row.recruiter_name || row.recruiterName || 'N/A',
        recruiterIds: row.recruiter_ids ? String(row.recruiter_ids).split(',').filter(Boolean) : [],
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
    };
    console.log("Success mapped");
  } catch(e) {
    console.error('Mapping Error:', e.message, e.stack);
  } finally {
    await prisma.$disconnect();
  }
}
test();
