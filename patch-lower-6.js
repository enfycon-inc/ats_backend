const fs = require('fs');
let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('LOWER(j.created_by)')) {
    lines[i] = ''; // blank it out
  }
}

fs.writeFileSync('src/jobs/jobs.service.ts', lines.join('\n'), 'utf-8');
console.log('Cleared out LOWER via includes LOWER');
