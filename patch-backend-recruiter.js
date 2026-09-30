const fs = require('fs');

let f = 'src/jobs/jobs.service.ts';
let c = fs.readFileSync(f, 'utf8');

// Replace the recruiter filter block
const recruiterRegex = /\} else if \(\!isGlobalOrBranchAdmin && user\?\.dbId\) \{[\s\S]*?\/\/ ── Sub-view Filter Parameters/m;

const newRecruiterBlock = `} else if (!isGlobalOrBranchAdmin && user?.dbId) {
      // 3. Recruiters: Only see approved/active jobs (unit isolation is already applied above)
      // They can see all jobs in their unit by default per user request.
      sql += \` AND (
        ((j.approval_status = 'APPROVED' OR j.approval_status IS NULL) AND UPPER(COALESCE(j.status, '')) NOT IN ('PENDING APPROVAL', 'PENDING_APPROVAL', 'DRAFT'))
        OR j.assigned_approver_id = \$\${paramIndex}::uuid
      )\`;
      params.push(user.dbId);
      paramIndex++;
    }

    // ── Sub-view Filter Parameters`;

c = c.replace(recruiterRegex, newRecruiterBlock);

// Replace filter === 'my'
const myFilterRegex = /if \(filter === 'my' && user\?\.dbId\) \{[\s\S]*?paramIndex \+= 1;\r?\n    \} else if \(filter === 'direct'/m;

const newMyFilterBlock = `if (filter === 'my' && user?.dbId) {
      if (isAccountManager) {
        sql += \` AND (j.account_manager_id = \$\${paramIndex}::uuid OR j.recruitment_manager_id = \$\${paramIndex}::uuid)\`;
      } else {
        sql += \` AND j.recruiter_id = \$\${paramIndex}::uuid\`;
      }
      params.push(user.dbId);
      paramIndex += 1;
    } else if (filter === 'direct'`;

c = c.replace(myFilterRegex, newMyFilterBlock);

fs.writeFileSync(f, c);
console.log('Fixed backend jobs.service.ts');
