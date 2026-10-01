const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');
bu = bu.split('        currency,\n').join('');
bu = bu.split('job.businessUnitRef?.market').join('(job.businessUnitRef as any)?.marketSegment?.code');
bu = bu.split('job.branch?.market').join('(job.branch as any)?.market');
fs.writeFileSync('src/business-units/business-units.service.ts', bu);
console.log("Fixed again!");
