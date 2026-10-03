const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  try {
    const id = '1e14a993-4d25-4d08-ac8d-f6135e94f95f';
    const sql = \SELECT j.*, rm.full_name AS recruitment_manager_name, 
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
         WHERE j.id = '\'::uuid AND j.deleted_at IS NULL LIMIT 1\;
    const res = await prisma.\$queryRawUnsafe(sql);
    console.log('Result length:', res.length);
  } catch(e) {
    console.error('Database Error:', e.message);
  } finally {
    await prisma.\$disconnect();
  }
}
test();
