const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-invite.service.ts', 'utf8');
data = data.replace(
  /SELECT id, is_active FROM users WHERE LOWER\(email\) = \$1 AND tenant_id = \$2 LIMIT 1',\s*\[cleanEmail, tenantId\]/g,
  "SELECT id, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1',\n        [cleanEmail]"
);
fs.writeFileSync('src/auth/services/auth-invite.service.ts', data);
