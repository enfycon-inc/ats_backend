const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/auth.service.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  'register(dto: RegisterDto, authHeader?: string) { return this.coreService.register(dto, authHeader); }',
  'register(dto: RegisterDto, requesterUser?: any) { return this.coreService.register(dto, requesterUser); }'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched auth.service.ts');
