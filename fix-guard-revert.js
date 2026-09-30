const fs = require('fs');
let data = fs.readFileSync('src/auth/guards/jwt-auth.guard.ts', 'utf8');

data = data.replace(
  "const safeDbRoles = (dbUser.roles || []);",
  "// Filter out SUPER_ADMIN from dbUser.roles to ensure it ONLY comes from Keycloak\n        const safeDbRoles = (dbUser.roles || []).filter((r: string) => r !== 'SUPER_ADMIN' && r !== 'super_admin');"
);

fs.writeFileSync('src/auth/guards/jwt-auth.guard.ts', data);
