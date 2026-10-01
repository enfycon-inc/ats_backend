const fs = require('fs');
const lines = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8').split('\n');
lines.forEach((l, i) => { if(l.includes('market')) console.log(`${i+1}: ${l}`); });
