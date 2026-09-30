const fs = require('fs');
let data = fs.readFileSync('src/auth/guards/jwt-auth.guard.ts', 'utf8');

const regex1 = /const realmRoles: string\[\] = \(decoded\.realm_access\?\.roles \|\| \[\]\)\.filter\(\(r: string\) => !isTechnicalKeycloakRole\(r\)\);/g;
const replace1 = `const realmRoles: string[] = (decoded.realm_access?.roles || []).map((r: string) => r.toUpperCase()).filter((r: string) => !isTechnicalKeycloakRole(r));`;
data = data.replace(regex1, replace1);

const regex2 = /clientRoles\.push\(\.\.\.client\.roles\.filter\(\(r: string\) => !isTechnicalKeycloakRole\(r\)\)\);/g;
const replace2 = `clientRoles.push(...client.roles.map((r: string) => r.toUpperCase()).filter((r: string) => !isTechnicalKeycloakRole(r)));`;
data = data.replace(regex2, replace2);

const regex3 = /const groupRoles: string\[\] = \(decoded\.groups \|\| \[\]\)\.filter\(\(r: string\) => !isTechnicalKeycloakRole\(r\)\);/g;
const replace3 = `const groupRoles: string[] = (decoded.groups || []).map((r: string) => r.toUpperCase()).filter((r: string) => !isTechnicalKeycloakRole(r));`;
data = data.replace(regex3, replace3);

fs.writeFileSync('src/auth/guards/jwt-auth.guard.ts', data);
