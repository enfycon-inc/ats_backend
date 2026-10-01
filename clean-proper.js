const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const lines = schema.split('\n');
let insideBU = false;
const newLines = [];

for (const line of lines) {
  if (line.includes('model BusinessUnit {')) {
    insideBU = true;
  }
  if (insideBU && line.includes('}')) {
    insideBU = false;
  }
  
  if (insideBU) {
    if (line.includes('market ') || line.includes('currency ')) {
      if (!line.includes('marketSegment')) {
        continue; // Skip this line!
      }
    }
  }
  newLines.push(line);
}

fs.writeFileSync('prisma/schema.prisma', newLines.join('\n'));
console.log("Successfully cleaned BusinessUnit market and currency!");
