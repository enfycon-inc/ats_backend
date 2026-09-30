const fs = require('fs');
let c = fs.readFileSync('prisma/schema.prisma', 'utf8');

c = c.replace(/assignedApproverRole\s+String\?\s+@map\("assigned_approver_role"\)\s+@db\.VarChar\(50\)\r?\n/g, '');
c = c.replace(/assignedApproverRole\s+String\?\s+@map\("assigned_approver_role"\)\s+@db\.VarChar\(50\)/g, '');

fs.writeFileSync('prisma/schema.prisma', c);
console.log('Fixed schema.prisma');
