const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

data = data.replace(
  /else \/\/ if \(dynamicRoles\.includes\('SUPER_ADMIN'\)\) systemRole = 'SUPER_ADMIN'; \/\/ STRICT KEYCLOAK ENFORCEMENT \/\/ STRICT KEYCLOAK ENFORCEMENT: DB roles cannot grant SUPER_ADMIN/g,
  ""
);

data = data.replace(
  /else \/\/ if \(dynamicRoles\.includes\('SUPER_ADMIN'\)\) systemRole = 'SUPER_ADMIN'; \/\/ STRICT KEYCLOAK ENFORCEMENT/g,
  ""
);

fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
