const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// Use simple string replacement but with escaped $ or exact matching
content = content.replace(
  'j.created_by = $${paramIndex}::text \\n\\n        OR j.recruitment_manager_id = $${paramIndex}::uuid',
  'j.created_by = $${paramIndex}::uuid \\n        OR j.account_manager_id = $${paramIndex}::uuid\\n        OR j.recruitment_manager_id = $${paramIndex}::uuid'
);

// Actually, I can just use a loop to replace the lines
let lines = content.split('\\n');

let inAMBlock = false;
let inMyBlock = false;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('if (isAccountManager && user?.dbId) {')) inAMBlock = true;
  if (lines[i].includes('} else if (!isGlobalOrBranchAdmin && user?.dbId) {')) inAMBlock = false;

  if (inAMBlock) {
    if (lines[i].includes('j.created_by = $${paramIndex}::text')) {
      lines[i] = '        j.created_by = $${paramIndex}::uuid ';
    }
    if (lines[i].includes('OR j.recruitment_manager_id = $${paramIndex}::uuid')) {
      lines[i] = '        OR j.account_manager_id = $${paramIndex}::uuid\\n        OR j.recruitment_manager_id = $${paramIndex}::uuid';
    }
  }

  if (lines[i].includes('if (filter === \\'my\\' && user?.dbId) {')) inMyBlock = true;
  if (lines[i].includes('} else if (filter === \\'direct\\' && user?.dbId) {')) inMyBlock = false;

  if (inMyBlock) {
    if (lines[i].includes('j.created_by = ${paramIndex}::uuid')) {
      lines[i] = '        j.created_by = $${paramIndex}::uuid ';
    }
    if (lines[i].includes('OR j.account_manager_id = ${paramIndex}::uuid')) {
      lines[i] = '        OR j.account_manager_id = $${paramIndex}::uuid ';
    }
    if (lines[i].includes('OR j.recruitment_manager_id = ${paramIndex}::uuid')) {
      lines[i] = '        OR j.recruitment_manager_id = $${paramIndex}::uuid';
    }
  }
}

fs.writeFileSync('src/jobs/jobs.service.ts', lines.join('\\n'), 'utf-8');
console.log('Fixed My Jobs and AM logic perfectly using lines array');
