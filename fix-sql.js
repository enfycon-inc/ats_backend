const fs = require('fs');
let c = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

// Fix mapRowToProfile - remove recruiterId (no longer in DB)
c = c.replace(
  /recruiterId: row\.recruiter_id \?\? row\.recruiterId \?\? '',\s*\r?\n/,
  ''
);

// Fix recruiterIds fallback - no longer fallback to row.recruiter_id
c = c.replace(
  /recruiterIds: row\.recruiter_ids \? row\.recruiter_ids\.split\(','\)\.filter\(Boolean\) : \(row\.recruiter_id \? \[row\.recruiter_id\] : \[\]\),/,
  "recruiterIds: row.recruiter_ids ? String(row.recruiter_ids).split(',').filter(Boolean) : [],"
);

// Fix assigned_to references in row mapping
c = c.replace(/row\.assigned_to \?\?[^\n]+\n/g, '');

fs.writeFileSync('src/jobs/jobs.service.ts', c);
console.log('mapRowToProfile fixed!');

// Verify no more recruiter_id in row reads
const after = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');
const remaining = (after.match(/row\.recruiter_id/g) || []).length;
console.log(`Remaining row.recruiter_id references: ${remaining}`);
