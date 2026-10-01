const fs = require('fs');
const lines = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8').split('\n');
lines.forEach((l, i) => { if(l.includes('market: true')) console.log(`${i+1}: ${l}`); });
