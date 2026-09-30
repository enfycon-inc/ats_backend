const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

data = data.replace(
  /let systemRole = user\.system_role \|\| 'RECRUITER';/g,
  "let systemRole = (user.system_role === 'SUPER_ADMIN' || user.system_role === 'super_admin') ? 'TENANT_ADMIN' : (user.system_role || 'RECRUITER');"
);

data = data.replace(
  /let systemRole = user\.is_approved \? \(user\.system_role \|\| 'RECRUITER'\) : 'PENDING';/g,
  "let systemRole = user.is_approved ? ((user.system_role === 'SUPER_ADMIN' || user.system_role === 'super_admin') ? 'TENANT_ADMIN' : (user.system_role || 'RECRUITER')) : 'PENDING';"
);

fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
