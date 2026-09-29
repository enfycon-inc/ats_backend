const fs = require('fs');
const file = 'src/auth/services/auth-init.service.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/const DEFAULT_TENANT_ID = .*;/g, "const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';");
fs.writeFileSync(file, code);
console.log('Fixed auth-init.service.ts TS error properly.');
