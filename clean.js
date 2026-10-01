const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const match = schema.match(/model BusinessUnit \{[\s\S]*?\}/);
if (match) {
  let buModel = match[0];
  buModel = buModel.replace(/market\s+String\s+@default\("US"\) @db\.VarChar\(50\)\n/, '');
  buModel = buModel.replace(/currency\s+String\s+@default\("USD"\) @db\.VarChar\(10\)\n/, '');
  schema = schema.replace(match[0], buModel);
  fs.writeFileSync('prisma/schema.prisma', schema);
  console.log("Replaced cleanly");
}
