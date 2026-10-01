const fs = require('fs');
const file = 'src/branches/branches.service.ts';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/managers: b\.managers\?/g, 'managers: b.users?');

fs.writeFileSync(file, c);
