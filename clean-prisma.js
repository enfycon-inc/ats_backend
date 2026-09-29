const fs = require('fs');
let c = fs.readFileSync('prisma/schema.prisma', 'utf8');

const jobStart = c.indexOf('model Job {');
const jobEnd = c.indexOf('}', jobStart);

let jobModel = c.substring(jobStart, jobEnd);

jobModel = jobModel.replace(/assignedTo\s+String\?\s+@map\("assigned_to"\)\s+@db\.VarChar\(255\)\r?\n?/g, '');
jobModel = jobModel.replace(/businessUnit\s+String\?\s+@map\("business_unit"\)\s+@db\.VarChar\(100\)\r?\n?/g, '');
jobModel = jobModel.replace(/clientName\s+String\s+@map\("client_name"\)\s+@db\.VarChar\(255\)\r?\n?/g, '');
jobModel = jobModel.replace(/endClientName\s+String\s+@map\("end_client_name"\)\s+@db\.VarChar\(255\)\r?\n?/g, '');
jobModel = jobModel.replace(/workingDays\s+String\?\s+@map\("working_days"\)\r?\n?/g, '');
jobModel = jobModel.replace(/workStartTime\s+String\?\s+@map\("work_start_time"\)\s+@db\.VarChar\(20\)\r?\n?/g, '');
jobModel = jobModel.replace(/workEndTime\s+String\?\s+@map\("work_end_time"\)\s+@db\.VarChar\(20\)\r?\n?/g, '');
jobModel = jobModel.replace(/timingSnapshotAt\s+DateTime\?\s+@map\("timing_snapshot_at"\)\s+@db\.Timestamptz\(6\)\r?\n?/g, '');

c = c.substring(0, jobStart) + jobModel + c.substring(jobEnd);

// Keep approved_by update
c = c.replace(/approvedBy\s+String\?\s+@map\("approved_by"\)\s+@db\.VarChar\(255\)/g, 'approvedBy           String?                @map("approved_by") @db.Uuid');

fs.writeFileSync('prisma/schema.prisma', c);
console.log('✅ Updated prisma/schema.prisma safely');
