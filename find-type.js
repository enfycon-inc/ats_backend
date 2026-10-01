const fs = require('fs');
const dts = fs.readFileSync('node_modules/.prisma/client/index.d.ts', 'utf8');
const match = dts.match(/type BusinessUnitUncheckedUpdateInput = \{[\s\S]*?\}/);
if (match) console.log(match[0]);
