const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/guards/jwt-auth.guard.ts');
let content = fs.readFileSync(filePath, 'utf8');

const regex = /const mergedRoles = Array\.from\(\n[\s\S]*?new Set\(\[\.\.\.\(realmRoles\.includes\('SUPER_ADMIN'\) \? \['SUPER_ADMIN'\] : \[\]\), \.\.\.\(dbUser\.roles \|\| \[\]\)\]\),\n[\s\S]*?\)/;

const replacement = `
      // Filter out SUPER_ADMIN from dbUser.roles to ensure it ONLY comes from Keycloak
      const safeDbRoles = (dbUser.roles || []).filter((r: string) => r !== 'SUPER_ADMIN' && r !== 'super_admin');
      
      const mergedRoles = Array.from(
        // Tenant roles come from current DB assignments. Only the platform realm role is authoritative in the token.
        new Set([...(realmRoles.includes('SUPER_ADMIN') ? ['SUPER_ADMIN'] : []), ...safeDbRoles]),
      )`;

content = content.replace(regex, replacement.trim());
fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched jwt-auth.guard.ts');
