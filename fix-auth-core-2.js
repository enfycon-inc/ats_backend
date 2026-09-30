const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

data = data.replace(
  /if \(dynamicRoles\.includes\('SUPER_ADMIN'\)\) systemRole = 'SUPER_ADMIN';/g,
  "// if (dynamicRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN'; // STRICT KEYCLOAK ENFORCEMENT"
);

fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
