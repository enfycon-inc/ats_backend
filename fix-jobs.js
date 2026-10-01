const fs = require('fs');
let jobs = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

jobs = jobs.replace(`unitCode = bu.code || (bu as any).marketSegment?.code || 'US'Segment?.code || 'GEN';`,
  `unitCode = bu.code || (bu as any).marketSegment?.code || 'GEN';`);

fs.writeFileSync('src/jobs/jobs.service.ts', jobs);
console.log("Fixed jobs service");
