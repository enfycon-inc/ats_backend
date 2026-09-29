const fs = require('fs');
let code = fs.readFileSync('schema.prisma', 'utf8');

code = code.replace(
  /model Resume \{\s*id\s+Int\s+@id @default\(autoincrement\(\)\)/,
  'model Resume {\n  id            String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid'
);

code = code.replace(
  /model Candidate \{\s*id\s+Int\s+@id @default\(autoincrement\(\)\)/,
  'model Candidate {\n  id                    String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid'
);

code = code.replace(
  /model RecruiterSubmission \{\s*id\s+Int\s+@id @default\(autoincrement\(\)\)/,
  'model RecruiterSubmission {\n  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid'
);

fs.writeFileSync('schema.prisma', code);
