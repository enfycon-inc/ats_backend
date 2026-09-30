const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

// In ssoLogin
data = data.replace(
  "else if (dynamicRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN';",
  "// else if (dynamicRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN'; // STRICT KEYCLOAK ENFORCEMENT: DB roles cannot grant SUPER_ADMIN"
);

// We need to do this for both places if it exists twice.
fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
