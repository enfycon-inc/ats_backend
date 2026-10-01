const fs = require('fs');
const file = 'src/branches/branches.service.ts';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/users: \{\s*where: \{\s*OR: \[\s*\{ customRole: \{ systemRole: \{ systemKey: 'BRANCH_ADMIN' \} \} \},\s*\{ systemRole: \{ systemKey: 'BRANCH_ADMIN' \} \}\s*\]\s*\},\s*select: \{ id: true, fullName: true, email: true \},\s*\}/g, 
  `users: {
            where: { customRole: { systemRole: { systemKey: 'BRANCH_ADMIN' } } },
            select: { id: true, fullName: true, email: true },
          }`);

fs.writeFileSync(file, c);
