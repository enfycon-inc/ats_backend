const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

data = data.replace(
  "if (kcRealmRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN';",
  "if (kcRealmRoles.includes('SUPER_ADMIN')) { systemRole = 'SUPER_ADMIN'; if (!dynamicRoles.includes('SUPER_ADMIN')) dynamicRoles.push('SUPER_ADMIN'); }"
);

fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
