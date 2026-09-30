const fs = require('fs');
let c = fs.readFileSync('src/jobs/dtos/create-job.dto.ts', 'utf8');

c = c.replace(/\s*@ApiPropertyOptional\({[^}]*}\)\s*assignedTo\?: string;\r?\n/g, '');
c = c.replace(/\s*@ApiPropertyOptional\({[^}]*}\)\s*assignedApproverRole\?: string;\r?\n/g, '');

fs.writeFileSync('src/jobs/dtos/create-job.dto.ts', c);
console.log('Fixed create-job.dto.ts');
