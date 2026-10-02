const fs = require('fs');
const file = 'src/jobs/jobs.service.ts';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/branchId,\s*approvalStatus: initialApprovalStatus/g, "branchId,\n            businessUnitId: dto.businessUnitId || null,\n            approvalStatus: initialApprovalStatus");

fs.writeFileSync(file, c);
