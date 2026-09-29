const fs = require('fs');
let content = fs.readFileSync('src/recruiter-submissions/recruiter-submissions.service.ts', 'utf-8');
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('LOWER(j.account_manager_id)')) lines[i] = '';
  if (lines[i].includes('LOWER(j.created_by)')) lines[i] = '';
  if (lines[i].includes('LOWER(s.recruiter_id)')) lines[i] = '';
  if (lines[i].includes('LOWER(account_manager_id)')) lines[i] = '';
  if (lines[i].includes('LOWER(created_by)')) lines[i] = '';
  if (lines[i].includes('j.business_unit')) lines[i] = ''; // Drop the entire business_unit line
}

// Now we need to remove the `::text` casting as well from the main clauses
let textContent = lines.join('\n');
textContent = textContent.replace(/j\.created_by = \$\{\w+\}::text/g, 'j.created_by = $${paramIndex}::uuid');
textContent = textContent.replace(/s\.recruiter_id = \$\{\w+\}::text/g, 's.recruiter_id = $${paramIndex}::uuid');
textContent = textContent.replace(/j\.account_manager_id = \$\{\w+\}::text/g, 'j.account_manager_id = $${paramIndex}::uuid');
textContent = textContent.replace(/created_by = \$\{\w+\}::text/g, 'created_by = $${paramIndex}::uuid');
textContent = textContent.replace(/account_manager_id = \$\{\w+\}::text/g, 'account_manager_id = $${paramIndex}::uuid');
textContent = textContent.replace(/recruiter_id = \$\{\w+\}::text/g, 'recruiter_id = $${paramIndex}::uuid');

// Check for joins like `uc.id::text = j.created_by`
textContent = textContent.replace(/id::text = /g, 'id = ');

fs.writeFileSync('src/recruiter-submissions/recruiter-submissions.service.ts', textContent, 'utf-8');
console.log('Cleared out LOWER and ::text from recruiter submissions');
