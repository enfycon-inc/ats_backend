const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'clients', 'clients.service.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace \` with `
content = content.replace(/\\`/g, '`');

// Replace \$ with $
content = content.replace(/\\\$/g, '$');

fs.writeFileSync(filePath, content, 'utf8');
console.log("Fixed clients.service.ts ticks");
