const fs = require('fs');
const lines = fs.readFileSync('prisma/schema.prisma', 'utf8').split('\n');
let inside = false;
for(let l of lines) {
  if (l.includes('model Branch {')) inside = true;
  if (inside) console.log(l.trim());
  if (inside && l.includes('}')) break;
}
