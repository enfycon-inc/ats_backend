const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');
let lines = content.split(/\r?\n/);

let am_block_start = -1;
let am_block_end = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('b.code AS branch_code') && lines[i+1].includes('FROM ats.jobs j')) {
    lines[i] = '             b.code AS branch_code,\n             cl.client_name AS mapped_client_name,\n             ecl.client_name AS mapped_end_client_name,\n             bu.name AS mapped_business_unit_name';
  }
  if (lines[i].includes('LEFT JOIN ats.branches b ON b.id = j.branch_id') && lines[i+1].includes('WHERE j.tenant_id = $1')) {
    lines[i] = '      LEFT JOIN ats.branches b ON b.id = j.branch_id\n      LEFT JOIN ats.clients cl ON cl.id = j.client_id\n      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id\n      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id';
  }
  if (lines[i].includes('client: row.client?.clientName || row.client_id,')) {
    lines[i] = '      client: row.mapped_client_name || row.client_id,';
  }
  
  if (lines[i].includes('if (isAccountManager && user?.dbId) {')) {
    am_block_start = i;
  }
  if (am_block_start !== -1 && am_block_end === -1 && lines[i].includes('} else if (!isGlobalOrBranchAdmin && user?.dbId) {')) {
    am_block_end = i;
  }
}

if (am_block_start !== -1 && am_block_end !== -1) {
  lines[am_block_start + 1] = '      if (user.businessUnitId) {';
  lines[am_block_start + 2] = '        sql += ` AND j.business_unit_id = $${paramIndex}::uuid`;';
  lines[am_block_start + 3] = '        params.push(user.businessUnitId);';
  lines[am_block_start + 4] = '      } else {';
  lines[am_block_start + 5] = '        sql += ` AND (j.created_by = $${paramIndex}::uuid OR j.account_manager_id = $${paramIndex}::uuid OR j.recruitment_manager_id = $${paramIndex}::uuid)`;';
  lines[am_block_start + 6] = '        params.push(user.dbId);';
  lines[am_block_start + 7] = '      }';
  lines[am_block_start + 8] = '      paramIndex += 1;';
  
  for (let j = am_block_start + 9; j < am_block_end; j++) {
    lines[j] = '';
  }
}

fs.writeFileSync('src/jobs/jobs.service.ts', lines.join('\n'), 'utf-8');
console.log('Fixed properly line by line');
