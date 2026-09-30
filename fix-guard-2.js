const fs = require('fs');
let data = fs.readFileSync('src/auth/guards/jwt-auth.guard.ts', 'utf8');

data = data.replace(
  "const safeDbRoles = (dbUser.roles || []).filter((r: string) => r !== 'SUPER_ADMIN' && r !== 'super_admin');",
  "const safeDbRoles = (dbUser.roles || []);"
);

fs.writeFileSync('src/auth/guards/jwt-auth.guard.ts', data);
