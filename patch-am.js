const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// 1. Fix Account Manager base filter
const oldAmFilter = `    if (isAccountManager && user?.dbId) {
      // Account manager cannot see jobs posted by other team members
      sql += \` AND (
        j.created_by = $\${paramIndex}::text 

        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;`;

const newAmFilter = `    if (isAccountManager && user?.dbId) {
      // Account manager cannot see jobs posted by other team members
      sql += \` AND (
        j.created_by = $\${paramIndex}::uuid 
        OR j.account_manager_id = $\${paramIndex}::uuid
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;`;

content = content.replace(oldAmFilter, newAmFilter);

// 2. Fix "My Jobs" filter
const oldMyFilter = `    if (filter === 'my' && user?.dbId) {
      // "My Jobs" view: only show jobs created by self
      sql += \` AND (
        j.created_by = \${paramIndex}::uuid 
          OR j.account_manager_id = \${paramIndex}::uuid 
          OR j.recruitment_manager_id = \${paramIndex}::uuid
      )\`;`;

const newMyFilter = `    if (filter === 'my' && user?.dbId) {
      // "My Jobs" view: only show jobs created by self
      sql += \` AND (
        j.created_by = $\${paramIndex}::uuid 
        OR j.account_manager_id = $\${paramIndex}::uuid 
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;`;

content = content.replace(oldMyFilter, newMyFilter);

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed My Jobs and AM logic perfectly');
