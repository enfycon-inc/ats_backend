const fs = require('fs');
let c = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

c = c.replace(/\|\| currentJob\.createdBy/g, '');

fs.writeFileSync('src/jobs/jobs.service.ts', c);
console.log('Fixed currentJob.createdBy');
