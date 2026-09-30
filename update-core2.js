const fs = require('fs');
let data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');

const regex = /if \(!targetTenantId\) \{[\s\S]*?throw new UnauthorizedException\([\s\S]*?'No account found for this email address in this workspace\. Please contact your organization administrator to be invited\.'[\s\S]*?\);[\s\S]*?\}/;

const replacement = `if (!targetTenantId) {
          throw new UnauthorizedException(
            'No account found for this email address in this workspace. Please contact your organization administrator to be invited.'
          );
        }

        const globalCheck = await this.authQuery.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail]);
        if (globalCheck.rows.length > 0) {
          throw new UnauthorizedException('This email is already registered to a different workspace. A single email cannot belong to multiple workspaces.');
        }`;

data = data.replace(regex, replacement);
fs.writeFileSync('src/auth/services/auth-core.service.ts', data);
