const fs = require('fs');
const path = require('path');
function search(dir, pattern) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === 'dist' || file === '.git') continue;
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) { search(fullPath, pattern); }
    else if (file.endsWith('.ts')) {
      if (fs.readFileSync(fullPath, 'utf8').includes(pattern)) { console.log('FOUND IN:', fullPath); }
    }
  }
}
search('.', 'resolveBranchId');
