const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// Replace exact lines
bu = bu.split('        market,').join('');
bu = bu.split('job.businessUnitRef?.market').join('(job.businessUnitRef as any)?.marketSegment?.code');
bu = bu.split('job.branch?.market').join('(job.branch as any)?.market');
fs.writeFileSync('src/business-units/business-units.service.ts', bu);

let jobs = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');
jobs = jobs.split('marketSegment: { select: { code: true } }').join('market: true');
fs.writeFileSync('src/jobs/jobs.service.ts', jobs);
