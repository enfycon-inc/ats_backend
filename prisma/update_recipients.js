const fs = require('fs');
let code = fs.readFileSync('schema.prisma', 'utf8');

code = code.replace(
  'candidateId Int?      @map("candidate_id")',
  'candidateId String?   @map("candidate_id") @db.Uuid'
);

fs.writeFileSync('schema.prisma', code);
