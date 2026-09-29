const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// 1. SELECT query joins
content = content.replace(
  'b.code AS branch_code\n      FROM ats.jobs j',
  'b.code AS branch_code,\n             cl.client_name AS mapped_client_name,\n             ecl.client_name AS mapped_end_client_name,\n             bu.name AS mapped_business_unit_name\n      FROM ats.jobs j'
);

content = content.replace(
  'LEFT JOIN ats.branches b ON b.id = j.branch_id\n      WHERE j.tenant_id = $1',
  'LEFT JOIN ats.branches b ON b.id = j.branch_id\n      LEFT JOIN ats.clients cl ON cl.id = j.client_id\n      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id\n      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id\n      WHERE j.tenant_id = $1'
);

content = content.replace(
  'client: row.client?.clientName || row.client_id,',
  'client: row.mapped_client_name || row.client_id,'
);

content = content.replace(
  'endClientName: row.mapped_end_client_name || row.end_client_id,',
  'endClientName: row.mapped_end_client_name || row.end_client_id,'
);

// 2. Fix the Account Manager block explicitly
const oldAmBlock = `    if (isAccountManager && user?.dbId) {
      // Account manager cannot see jobs posted by other team members
      sql += \` AND (
        j.created_by = $\${paramIndex}::uuid 

        OR j.account_manager_id = $\${paramIndex}::uuid
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;
      params.push(user.dbId);
      paramIndex += 1;`;

const newAmBlock = `    if (isAccountManager && user?.dbId) {
      if (user.businessUnitId) {
        sql += \` AND j.business_unit_id = $\${paramIndex}::uuid\`;
        params.push(user.businessUnitId);
      } else {
        sql += \` AND (j.created_by = $\${paramIndex}::uuid OR j.account_manager_id = $\${paramIndex}::uuid OR j.recruitment_manager_id = $\${paramIndex}::uuid)\`;
        params.push(user.dbId);
      }
      paramIndex += 1;`;

content = content.replace(oldAmBlock, newAmBlock);

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed using robust string replace');
