const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/auth.controller.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Remove the one I added: `import { AuthUser } from './decorators/current-user.decorator';`
content = content.replace("import { AuthUser } from './decorators/current-user.decorator';\n", "");

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched auth.controller.ts imports');
