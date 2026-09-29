const fs = require('fs');

function replaceInFile(path, replacements) {
  let content = fs.readFileSync(path, 'utf-8');
  let original = content;
  for (const [search, replace] of replacements) {
    if (search instanceof RegExp) {
      content = content.replace(search, replace);
    } else {
      content = content.split(search).join(replace);
    }
  }
  if (content !== original) {
    fs.writeFileSync(path, content, 'utf-8');
    console.log(`Updated ${path}`);
  }
}

replaceInFile('src/jobs/jobs.service.ts', [
  // 1. LEFT JOIN ats.users uc
  [
    `LEFT JOIN ats.users uc ON (
        uc.id::text = j.created_by 
        OR LOWER(uc.email) = LOWER(j.created_by) 
        OR LOWER(uc.full_name) = LOWER(j.created_by)
      )`,
    `LEFT JOIN ats.users uc ON (uc.id = j.created_by)`
  ],
  [
    `LEFT JOIN ats.users uc ON (
           uc.id::text = j.created_by 
           OR LOWER(uc.email) = LOWER(j.created_by) 
           OR LOWER(uc.full_name) = LOWER(j.created_by)
         )`,
    `LEFT JOIN ats.users uc ON (uc.id = j.created_by)`
  ],
  // 2. Account Manager filter
  [
    `j.created_by = $${paramIndex}::text \n        OR LOWER(j.created_by) = LOWER($${paramIndex + 1})\n        OR j.recruitment_manager_id = $${paramIndex}::uuid`,
    `j.created_by = $${paramIndex}::uuid \n        OR j.recruitment_manager_id = $${paramIndex}::uuid`
  ],
  [
    `j.created_by = $${paramIndex}::text \n          OR LOWER(j.created_by) = LOWER($${paramIndex + 1})\n          OR j.recruitment_manager_id = $${paramIndex}::uuid`,
    `j.created_by = $${paramIndex}::uuid \n          OR j.recruitment_manager_id = $${paramIndex}::uuid`
  ]
]);

// Wait, the string split logic is very fragile due to whitespace.
// Let's use robust Regexes!
let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

// Replace LEFT JOIN user uc
content = content.replace(/LEFT JOIN ats\.users uc ON \([\s\S]*?LOWER\(uc\.full_name\) = LOWER\(j\.created_by\)[\s\S]*?\)/g, 'LEFT JOIN ats.users uc ON (uc.id = j.created_by)');

// Replace Account Manager condition
content = content.replace(/j\.created_by = \$\{\w+\}::text[\s\S]*?OR LOWER\(j\.created_by\) = LOWER\(\$\{\w+ \+ 1\}\)[\s\S]*?OR j\.recruitment_manager_id = \$\{\w+\}::uuid/g, 
function(match) {
  const paramIndexMatch = match.match(/\$\{(\w+)\}/);
  if (paramIndexMatch) {
    const idx = paramIndexMatch[1];
    return `j.created_by = \$\{${idx}\}::uuid OR j.recruitment_manager_id = \$\{${idx}\}::uuid`;
  }
  return match;
});

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
console.log('Fixed created_by LOWER() queries');
