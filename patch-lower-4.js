const fs = require('fs');
let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

content = content.replace(/j\.created_by = \$\{\w+\}::text\s*OR LOWER\(j\.created_by\) = LOWER\(\$\{\w+ \+ 1\}\)\s*OR j\.recruitment_manager_id = \$\{\w+\}::uuid/g, function(match) {
  const pMatch = match.match(/\$\{(\w+)\}/);
  if (pMatch) {
    const idx = pMatch[1];
    return `j.created_by = \$\{${idx}\}::uuid OR j.recruitment_manager_id = \$\{${idx}\}::uuid`;
  }
  return match;
});

content = content.replace(/j\.created_by = \$\{\w+\}::text[\s\S]*?LOWER\(j\.created_by\)[\s\S]*?::uuid/g, function(match) {
  const pMatch = match.match(/\$\{(\w+)\}/);
  if (pMatch) {
    const idx = pMatch[1];
    return `j.created_by = \$\{${idx}\}::uuid \n        OR j.recruitment_manager_id = \$\{${idx}\}::uuid`;
  }
  return match;
});

fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
