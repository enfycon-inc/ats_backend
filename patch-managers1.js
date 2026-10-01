const fs = require('fs');
const file = 'src/branches/branches.service.ts';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/managers: \{\s*select: \{ id: true, fullName: true, email: true \},\s*\}/g, 
  `users: {
            where: {
              OR: [
                { customRole: { systemRole: { systemKey: 'BRANCH_ADMIN' } } },
                { systemRole: { systemKey: 'BRANCH_ADMIN' } }
              ]
            },
            select: { id: true, fullName: true, email: true },
          }`);

fs.writeFileSync(file, c);
