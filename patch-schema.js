const fs = require('fs');
let c = fs.readFileSync('prisma/schema.prisma', 'utf8');

c = c.replace(/expMax\s+Int\?\s+@default\(10\)\s+@map\("exp_max"\)\r?\n\s+createdBy\s+String\?\s+@map\("created_by"\)\s+@db\.Uuid/g, 'expMax               Int?                   @default(10) @map("exp_max")');

fs.writeFileSync('prisma/schema.prisma', c);
console.log('Done');
