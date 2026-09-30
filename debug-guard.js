const fs = require('fs');
let data = fs.readFileSync('src/auth/guards/jwt-auth.guard.ts', 'utf8');

const target = "const realmRoles: string[] = (decoded.realm_access?.roles || []).map";
const replace = "console.log(`[DEBUG] Keycloak realm_access.roles:`, decoded.realm_access?.roles);\n        " + target;
data = data.replace(target, replace);

fs.writeFileSync('src/auth/guards/jwt-auth.guard.ts', data);
