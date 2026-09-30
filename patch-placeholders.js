const fs = require('fs');

let f = 'src/jobs/jobs.service.ts';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/OR j\.assigned_approver_id = \$\{paramIndex\}::uuid/g, 'OR j.assigned_approver_id = $${paramIndex}::uuid');
c = c.replace(/j\.account_manager_id = \$\{paramIndex\}::uuid/g, 'j.account_manager_id = $${paramIndex}::uuid');
c = c.replace(/j\.recruitment_manager_id = \$\{paramIndex\}::uuid/g, 'j.recruitment_manager_id = $${paramIndex}::uuid');
c = c.replace(/AND j\.recruiter_id = \$\{paramIndex\}::uuid/g, 'AND j.recruiter_id = $${paramIndex}::uuid');

fs.writeFileSync(f, c);
console.log('Fixed postgres variables in jobs.service.ts');
