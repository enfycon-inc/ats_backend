const fs = require('fs');
const path = require('path');

const filesToClean = [
  'src/auth/guards/jwt-auth.guard.ts',
  'src/auth/services/auth-keycloak.service.ts',
  'src/auth/services/auth-tenant.service.ts',
  'src/auth/utils/tenant-resolver.ts'
];

for (const file of filesToClean) {
  const filePath = path.join(__dirname, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  content = content.replace(/const DEFAULT_TENANT_ID = process\.env\.DEFAULT_TENANT_ID \|\| 'd3b07384-d113-49c3-a555-9ee75c13ca33';/g, 
    "const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID as string;");
    
  fs.writeFileSync(filePath, content, 'utf8');
}

// Clean up auth.ts in frontend
const authTsPath = path.join(__dirname, '../ats_frontend_main/auth.ts');
if (fs.existsSync(authTsPath)) {
  let authTsContent = fs.readFileSync(authTsPath, 'utf8');
  authTsContent = authTsContent.replace(/const DEFAULT_TENANT_ID = process\.env\.DEFAULT_TENANT_ID \|\| 'd3b07384-d113-49c3-a555-9ee75c13ca33';/g,
    "const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID as string;");
  fs.writeFileSync(authTsPath, authTsContent, 'utf8');
}

console.log('Successfully cleaned hardcoded fallbacks.');
