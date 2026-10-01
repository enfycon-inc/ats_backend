const fs = require('fs');
const lines = fs.readFileSync('prisma/schema.prisma', 'utf8').split('\n');
lines.forEach((l, i) => { if(l.includes('market') || l.includes('currency')) console.log(`${i+1}: ${l}`); });
