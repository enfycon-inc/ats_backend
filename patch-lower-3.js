const fs = require('fs');
let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

content = content.replace(
  'j.created_by = $${paramIndex}::text \n        OR LOWER(j.created_by) = LOWER($${paramIndex + 1})\n        OR j.recruitment_manager_id = $${paramIndex}::uuid',
  'j.created_by = $${paramIndex}::uuid \n        OR j.recruitment_manager_id = $${paramIndex}::uuid'
);
content = content.replace(
  'j.created_by = $${paramIndex}::text \n          OR LOWER(j.created_by) = LOWER($${paramIndex + 1})\n          OR j.recruitment_manager_id = $${paramIndex}::uuid',
  'j.created_by = $${paramIndex}::uuid \n          OR j.recruitment_manager_id = $${paramIndex}::uuid'
);

content = content.replace(/params\.push\(user\.email \|\| user\.dbId\);\s+paramIndex \+= 2;/g, 'paramIndex += 1;');

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed created_by LOWER() queries with strings');
