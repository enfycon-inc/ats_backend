const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/auth.controller.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/import \{ AuthUser \} from '\.\/decorators\/current-user\.decorator';\r?\n?/, "");

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed typescript error properly');
