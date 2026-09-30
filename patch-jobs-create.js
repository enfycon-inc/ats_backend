const fs = require('fs');
let c = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

c = c.replace(/createdBy: createdByEmail \|\| 'System',\r?\n/g, '');
// Wait, the JobProfile interface still has createdBy: string. We can keep it in the interface or rename it to creatorName
// The frontend uses job.createdBy as the name of the creator/AM.
// Let's leave JobProfile.createdBy mapping to row.creator_name.

fs.writeFileSync('src/jobs/jobs.service.ts', c);
console.log('Fixed Prisma create in jobs.service.ts');
