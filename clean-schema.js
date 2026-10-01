const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const lines = schema.split('\n');
const newLines = lines.filter(line => !line.trim().startsWith('market ') && !line.trim().startsWith('currency '));
fs.writeFileSync('prisma/schema.prisma', newLines.join('\n'));
console.log("Cleaned BU schema");
