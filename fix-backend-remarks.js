const fs = require('fs');
const file = 'src/recruiter-submissions/recruiter-submissions.controller.ts';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(
  "if (branchId && branchId !== user.branchId) throw new ForbiddenException('You can only view remarks for your assigned branch.');",
  "// Allow cross-branch template viewing for co-sourced jobs\n        // if (branchId && branchId !== user.branchId) throw new ForbiddenException('You can only view remarks for your assigned branch.');"
);

fs.writeFileSync(file, c);
console.log('Fixed backend controller');
