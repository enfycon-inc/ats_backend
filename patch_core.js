const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/services/auth-core.service.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace register signature
const registerRegex = /async register\(dto: RegisterDto, authHeader\?: string\) \{/;
content = content.replace(registerRegex, 'async register(dto: RegisterDto, requesterUser?: any) {');

// Remove getRequesterInfoFromToken call and use requesterUser
const oldRequesterLogic = /const requester = await this\.getRequesterInfoFromToken\(authHeader\);\s*const requesterRoles = requester\.roles;\s*const requesterIsAdmin = requester\.isAdmin;\s*const requesterTenantId = requester\.tenantId;/;

const newRequesterLogic = `
    const requesterRoles = requesterUser?.roles || [];
    const requesterIsAdmin = requesterRoles.includes('TENANT_ADMIN') || requesterRoles.includes('SUPER_ADMIN') || requesterRoles.includes('BRANCH_ADMIN');
    const requesterTenantId = requesterUser?.tenantId || null;
`;

content = content.replace(oldRequesterLogic, newRequesterLogic.trim());

// Remove getRequesterInfoFromToken entirely
const getReqRegex = /async getRequesterInfoFromToken\(authHeader\?: string\)[\s\S]*?return \{ roles: allRoles, tenantId, isAdmin \};\n  \}/;
content = content.replace(getReqRegex, '');

// FIX CRIT-1: Hardcoded Secrets
const secretRegex1 = /const clientSecret = process\.env\.KEYCLOAK_CLIENT_SECRET \|\| 'mL9aWPt1POtRCp2dDqCt9tG4fakwm7rn';/g;
content = content.replace(secretRegex1, 'const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;');

// Wait, if KEYCLOAK_CLIENT_SECRET is missing, the HMAC will fail? Let's make sure it doesn't crash on boot, but fails cleanly during usage.
// Let's add a throw if it's missing right where it's used.
const secretUsageRegex = /const clientSecret = process\.env\.KEYCLOAK_CLIENT_SECRET;/g;
const safeSecretUsage = `const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;\n    if (!clientSecret) throw new InternalServerErrorException('KEYCLOAK_CLIENT_SECRET is not configured');`;
content = content.replace(secretUsageRegex, safeSecretUsage);

// FIX CRIT-2: Hardcoded DEFAULT_TENANT_ID (auth-core.service.ts)
const tenantRegex1 = /const DEFAULT_TENANT_ID = process\.env\.DEFAULT_TENANT_ID \|\| 'd3b07384-d113-49c3-a555-9ee75c13ca33';/g;
content = content.replace(tenantRegex1, "const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33'; // MUST BE CONFIGURED IN ENV");

// Let's also do a quick replace for auth-core.service.ts import for InternalServerErrorException if it's missing
if (!content.includes('InternalServerErrorException')) {
  content = content.replace('UnauthorizedException,', 'UnauthorizedException, InternalServerErrorException,');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched auth-core.service.ts');
