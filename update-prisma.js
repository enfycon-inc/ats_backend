const fs = require('fs');
let c = fs.readFileSync('prisma/schema.prisma', 'utf8');

c = c.replace(/accountManagerId\s+String\?\s+@map\("account_manager_id"\)\s+@db\.VarChar\(255\)/g, 'accountManagerId     String?                @map("account_manager_id") @db.Uuid');
c = c.replace(/recruitmentManagerId\s+String\?\s+@map\("recruitment_manager_id"\)\s+@db\.VarChar\(255\)/g, 'recruitmentManagerId String?                @map("recruitment_manager_id") @db.Uuid');
c = c.replace(/primaryRecruiterId\s+String\?\s+@map\("primary_recruiter_id"\)\s+@db\.VarChar\(255\)/g, 'primaryRecruiterId   String?                @map("primary_recruiter_id") @db.Uuid');
c = c.replace(/createdBy\s+String\?\s+@map\("created_by"\)\s+@db\.VarChar\(255\)/g, 'createdBy            String?                @map("created_by") @db.Uuid');

fs.writeFileSync('prisma/schema.prisma', c);
console.log('✅ Updated prisma/schema.prisma column types to Uuid');
