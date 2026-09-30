const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

data = data.replace(
  /dynamicRoles = Array\.from\(new Set\(\(rolesResult\.rows as any\[\]\)\.map\(\(row\) => row\.name\)\)\);/g,
  "dynamicRoles = Array.from(new Set((rolesResult.rows as any[]).map((row) => row.name))).filter(r => r !== 'SUPER_ADMIN');"
);

data = data.replace(
  /if \(dynamicRoles\.length === 0 && user\.role_name\) dynamicRoles = \[user\.role_name\];/g,
  "if (dynamicRoles.length === 0 && user.role_name) dynamicRoles = user.role_name === 'SUPER_ADMIN' ? [] : [user.role_name];"
);

data = data.replace(
  /if \(dynamicRoles\.length === 0\) dynamicRoles = \[user\.system_role \|\| 'RECRUITER'\];/g,
  "if (dynamicRoles.length === 0) dynamicRoles = [(user.system_role === 'SUPER_ADMIN' ? 'TENANT_ADMIN' : user.system_role) || 'RECRUITER'];"
);

data = data.replace(
  /if \(dynamicRoles\.length === 0 && user\.is_approved\) dynamicRoles = \[user\.system_role \|\| 'RECRUITER'\];/g,
  "if (dynamicRoles.length === 0 && user.is_approved) dynamicRoles = [(user.system_role === 'SUPER_ADMIN' ? 'TENANT_ADMIN' : user.system_role) || 'RECRUITER'];"
);

fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
