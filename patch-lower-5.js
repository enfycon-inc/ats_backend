const fs = require('fs');
let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('OR LOWER(j.created_by) = LOWER(${paramIndex + 1})')) {
    lines[i] = ''; // blank it out
  }
  if (lines[i].includes('j.created_by = ${paramIndex}::text')) {
    lines[i] = lines[i].replace('::text', '::uuid');
  }
}

fs.writeFileSync('src/jobs/jobs.service.ts', lines.join('\n'), 'utf-8');
console.log('Cleared out LOWER via lines split');
