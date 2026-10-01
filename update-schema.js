const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

schema = schema.replace(/tenantId\s+String\?\s+@map\("tenant_id"\) @db\.Uuid\n/, '');
schema = schema.replace(/defaultTimezone\s+String\s+@default\("America\/New_York"\) @map\("default_timezone"\) @db\.VarChar\(100\)\n/, '');
schema = schema.replace(/defaultShift\s+String\s+@default\("General Shift"\) @map\("default_shift"\) @db\.VarChar\(100\)\n/, '');
schema = schema.replace(/defaultStartTime\s+String\?\s+@default\("09:00"\) @map\("default_start_time"\) @db\.VarChar\(20\)\n/, '');
schema = schema.replace(/defaultEndTime\s+String\?\s+@default\("18:00"\) @map\("default_end_time"\) @db\.VarChar\(20\)\n/, '');

fs.writeFileSync('prisma/schema.prisma', schema);
console.log("Updated Prisma schema");
