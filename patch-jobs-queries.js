const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// 1. Add JOINs to findAllJobs
content = content.replace(
  `b.code AS branch_code
      FROM ats.jobs j`,
  `b.code AS branch_code,
             cl.client_name AS mapped_client_name,
             ecl.client_name AS mapped_end_client_name,
             bu.name AS mapped_business_unit_name
      FROM ats.jobs j`
);

content = content.replace(
  `LEFT JOIN ats.branches b ON b.id = j.branch_id
      WHERE j.tenant_id = $1`,
  `LEFT JOIN ats.branches b ON b.id = j.branch_id
      LEFT JOIN ats.clients cl ON cl.id = j.client_id
      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
      WHERE j.tenant_id = $1`
);

// 2. Add JOINs to findOneJob (has two branches of query)
content = content.replace(
  `uc.full_name AS creator_name, uc.email AS creator_email
         FROM ats.jobs j`,
  `uc.full_name AS creator_name, uc.email AS creator_email,
                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name
         FROM ats.jobs j`
);

content = content.replace(
  `LEFT JOIN ats.users uc ON (uc.id = j.created_by)
         WHERE j.tenant_id = $1 AND j.id = $2::uuid AND j.deleted_at IS NULL LIMIT 1\``,
  `LEFT JOIN ats.users uc ON (uc.id = j.created_by)
         LEFT JOIN ats.clients cl ON cl.id = j.client_id
         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
         WHERE j.tenant_id = $1 AND j.id = $2::uuid AND j.deleted_at IS NULL LIMIT 1\``
);

content = content.replace(
  `LEFT JOIN ats.users uc ON (uc.id = j.created_by)
         WHERE j.tenant_id = $1 AND j.job_code = $2 AND j.deleted_at IS NULL LIMIT 1\``,
  `LEFT JOIN ats.users uc ON (uc.id = j.created_by)
         LEFT JOIN ats.clients cl ON cl.id = j.client_id
         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
         WHERE j.tenant_id = $1 AND j.job_code = $2 AND j.deleted_at IS NULL LIMIT 1\``
);

// 3. Update mapRowToProfile mappings
content = content.replace(
  `client: row.client?.clientName || row.client_id,`,
  `client: row.mapped_client_name || row.client_id,`
);
content = content.replace(
  `endClientName: row.end_client?.clientName || row.end_client_id,`,
  `endClientName: row.mapped_end_client_name || row.end_client_id,`
);
content = content.replace(
  `businessUnit: row.business_unit ?? row.businessUnit ?? '',`,
  `businessUnit: row.mapped_business_unit_name || row.business_unit_id || '',`
);

// 4. Fix Account Manager My Jobs logic
content = content.replace(
  `j.created_by = \${paramIndex}::uuid \n          OR j.recruitment_manager_id = \${paramIndex}::uuid`,
  `j.created_by = $${paramIndex}::uuid \n          OR j.account_manager_id = $${paramIndex}::uuid \n          OR j.recruitment_manager_id = $${paramIndex}::uuid`
);
// Also the filter === 'my' section
content = content.replace(
  `sql += \` AND (
        j.created_by = \${paramIndex}::uuid 
          OR j.recruitment_manager_id = \${paramIndex}::uuid
      )\`;`,
  `sql += \` AND (
        j.created_by = $\${paramIndex}::uuid 
          OR j.account_manager_id = $\${paramIndex}::uuid
          OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;`
);

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed client joins and My Jobs logic');
