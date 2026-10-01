const fs = require('fs');
let c = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

// 1. Remove rawRolesList pushing RECRUITER
c = c.replace(
  /if \(rawRolesList\.length === 0\) rawRolesList\.push\('RECRUITER'\);/,
  `// if (rawRolesList.length === 0) rawRolesList.push('RECRUITER'); // Disabled auto-recruiter fallback`
);

// 2. Remove primaryRoleName RECRUITER fallback
c = c.replace(
  /if \(\!primaryRoleName \|\| primaryRoleName === 'RECRUITER'\) primaryRoleName = r\.name;/,
  `if (!primaryRoleName) primaryRoleName = r.name;`
);

// 3. Update login response fallback
c = c.replace(
  /if \(dynamicRoles\.length === 0 && user\.is_approved\) dynamicRoles = \[\(user\.system_role === 'SUPER_ADMIN' \? 'TENANT_ADMIN' : user\.system_role\) \|\| 'RECRUITER'\];/,
  `if (dynamicRoles.length === 0 && user.is_approved) dynamicRoles = [(user.system_role === 'SUPER_ADMIN' ? 'TENANT_ADMIN' : user.system_role) || 'UNASSIGNED'];`
);

c = c.replace(
  /let systemRole = user\.is_approved \? \(\(user\.system_role === 'SUPER_ADMIN' \|\| user\.system_role === 'super_admin'\) \? 'TENANT_ADMIN' : \(user\.system_role \|\| 'RECRUITER'\)\) : 'PENDING';/,
  `let systemRole = user.is_approved ? ((user.system_role === 'SUPER_ADMIN' || user.system_role === 'super_admin') ? 'TENANT_ADMIN' : (user.system_role || 'UNASSIGNED')) : 'PENDING';`
);

fs.writeFileSync('src/auth/services/auth-core.service.ts', c);
console.log("Removed RECRUITER fallback in auth-core");
