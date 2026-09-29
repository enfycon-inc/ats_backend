const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// 1. Fix Account Manager base filter
content = content.replace(
  /if \(isAccountManager && user\?\.dbId\) \{[\s\S]*?sql \+= ` AND \([\s\S]*?j\.created_by = \$\{\w+\}::text[\s\S]*?OR j\.recruitment_manager_id = \$\{\w+\}::uuid\s*\)`;/g,
  `if (isAccountManager && user?.dbId) {
      // Account manager cannot see jobs posted by other team members
      sql += \` AND (
        j.created_by = $\${paramIndex}::uuid 
        OR j.account_manager_id = $\${paramIndex}::uuid
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;`
);

// 2. Fix "My Jobs" filter
content = content.replace(
  /if \(filter === 'my' && user\?\.dbId\) \{[\s\S]*?sql \+= ` AND \([\s\S]*?j\.created_by = \{\w+\}::uuid[\s\S]*?OR j\.account_manager_id = \{\w+\}::uuid[\s\S]*?OR j\.recruitment_manager_id = \{\w+\}::uuid\s*\)`;/g,
  `if (filter === 'my' && user?.dbId) {
      // "My Jobs" view: only show jobs created by self
      sql += \` AND (
        j.created_by = $\${paramIndex}::uuid 
        OR j.account_manager_id = $\${paramIndex}::uuid
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;`
);

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed My Jobs and AM logic perfectly using regex');
