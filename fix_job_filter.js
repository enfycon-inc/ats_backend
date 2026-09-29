const fs = require('fs');
let c = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

const regex = /j\.created_by = \$\{paramIndex\}::text[\s\S]*?OR LOWER\(j\.created_by\) = LOWER\(\$\{paramIndex \+ 1\}\)[\s\S]*?OR j\.recruitment_manager_id = \$\{paramIndex\}::uuid/;

c = c.replace(regex, "j.created_by = $$$${paramIndex}::text \n          OR LOWER(j.created_by) = LOWER($$$${paramIndex + 1})\n          OR j.recruitment_manager_id = $$$${paramIndex}::uuid");

fs.writeFileSync('src/jobs/jobs.service.ts', c);
console.log("Fixed for real!");
