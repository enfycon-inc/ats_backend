const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/services/auth-core.service.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/}, authHeader\?: string\) \{/, '}, requesterUser?: any) {');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched auth-core.service.ts signature');
