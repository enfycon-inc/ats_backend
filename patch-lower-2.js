const fs = require('fs');

let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// Replace LEFT JOIN user uc
content = content.replace(/LEFT JOIN ats\.users uc ON \([\s\S]*?LOWER\(uc\.full_name\) = LOWER\(j\.created_by\)[\s\S]*?\)/g, 'LEFT JOIN ats.users uc ON (uc.id = j.created_by)');

// Replace Account Manager condition
content = content.replace(/j\.created_by = \$\{(\w+)\}::text[\s\S]*?OR LOWER\(j\.created_by\) = LOWER\(\$\{\w+ \+ 1\}\)[\s\S]*?OR j\.recruitment_manager_id = \$\{\w+\}::uuid/g, 
function(match, idx) {
  return `j.created_by = \$\{${idx}\}::uuid OR j.recruitment_manager_id = \$\{${idx}\}::uuid`;
});

// Remove params.push(user.email || user.dbId); because we removed the paramIndex + 1!
content = content.replace(/params\.push\(user\.email \|\| user\.dbId\);\s+paramIndex \+= 2;/g, 'paramIndex += 1;');

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed created_by LOWER() queries');
