const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// 1. Add JOINs to findAllJobs
content = content.replace(
  'b.code AS branch_code\n      FROM ats.jobs j',
  'b.code AS branch_code,\n             cl.client_name AS mapped_client_name,\n             ecl.client_name AS mapped_end_client_name,\n             bu.name AS mapped_business_unit_name\n      FROM ats.jobs j'
);

content = content.replace(
  'LEFT JOIN ats.branches b ON b.id = j.branch_id\n      WHERE j.tenant_id = $1',
  'LEFT JOIN ats.branches b ON b.id = j.branch_id\n      LEFT JOIN ats.clients cl ON cl.id = j.client_id\n      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id\n      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id\n      WHERE j.tenant_id = $1'
);

// 2. Add JOINs to findOneJob
content = content.replace(
  /uc\.full_name AS creator_name, uc\.email AS creator_email\s+FROM ats\.jobs j/g,
  'uc.full_name AS creator_name, uc.email AS creator_email,\n                cl.client_name AS mapped_client_name, ecl.client_name AS mapped_end_client_name, bu.name AS mapped_business_unit_name\n         FROM ats.jobs j'
);

content = content.replace(
  /LEFT JOIN ats\.users uc ON \(uc\.id = j\.created_by\)\s+WHERE j\.tenant_id = \$1 AND j\.id = \$2::uuid AND j\.deleted_at IS NULL LIMIT 1`/g,
  'LEFT JOIN ats.users uc ON (uc.id = j.created_by)\n         LEFT JOIN ats.clients cl ON cl.id = j.client_id\n         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id\n         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id\n         WHERE j.tenant_id = $1 AND j.id = $2::uuid AND j.deleted_at IS NULL LIMIT 1`'
);

content = content.replace(
  /LEFT JOIN ats\.users uc ON \(uc\.id = j\.created_by\)\s+WHERE j\.tenant_id = \$1 AND j\.job_code = \$2 AND j\.deleted_at IS NULL LIMIT 1`/g,
  'LEFT JOIN ats.users uc ON (uc.id = j.created_by)\n         LEFT JOIN ats.clients cl ON cl.id = j.client_id\n         LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id\n         LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id\n         WHERE j.tenant_id = $1 AND j.job_code = $2 AND j.deleted_at IS NULL LIMIT 1`'
);

// 3. Update mapRowToProfile mappings
content = content.replace(
  'client: row.client?.clientName || row.client_id,',
  'client: row.mapped_client_name || row.client_id,'
);
content = content.replace(
  'endClientName: row.end_client?.clientName || row.end_client_id,',
  'endClientName: row.mapped_end_client_name || row.end_client_id,'
);
content = content.replace(
  'businessUnit: row.business_unit ?? row.businessUnit ?? \'\',',
  'businessUnit: row.mapped_business_unit_name || row.business_unit_id || \'\','
);

// 4. Fix Account Manager My Jobs logic
content = content.replace(
  /j\.created_by = \$\{(\w+)\}::uuid \n\s*OR j\.recruitment_manager_id = \$\{(\w+)\}::uuid/g,
  'j.created_by = $${$1}::uuid \n          OR j.account_manager_id = $${$1}::uuid \n          OR j.recruitment_manager_id = $${$1}::uuid'
);

// Fix the one that lost the `$`
content = content.replace(
  /j\.created_by = \$\{(\w+)\}::uuid \n\s*OR j\.recruitment_manager_id = \$\{(\w+)\}::uuid/g,
  'j.created_by = $${$1}::uuid \n          OR j.account_manager_id = $${$1}::uuid \n          OR j.recruitment_manager_id = $${$1}::uuid'
);
content = content.replace(/j\.created_by = \{paramIndex\}::uuid/g, 'j.created_by = $${paramIndex}::uuid');
content = content.replace(/j\.recruitment_manager_id = \{paramIndex\}::uuid/g, 'j.recruitment_manager_id = $${paramIndex}::uuid');

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed client joins and My Jobs logic (safe)');
