const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

schema = schema.replace(/market\s+String\s+@default\("US"\) @db\.VarChar\(50\)\n/, '');
schema = schema.replace(/currency\s+String\s+@default\("USD"\) @db\.VarChar\(10\)\n/, '');

fs.writeFileSync('prisma/schema.prisma', schema);
console.log("Updated Prisma schema for BusinessUnit");
