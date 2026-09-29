const fs = require('fs');
let content = fs.readFileSync('src/jobs/jobs.service.ts', 'utf-8');

const toReplace = [
  // create() assignments
  /businessUnit: dto\.businessUnit \|\| tenantName,/g,
  /assignedTo: dto\.assignedTo \|\| 'N\/A',/g,
  /workStartTime,/g,
  /workEndTime,/g,
  /workingDays,/g,
  // update() assignments
  /if \(dto\.businessUnit !== undefined\) dataToUpdate\.businessUnit = dto\.businessUnit;/g,
  /if \(dto\.workStartTime !== undefined\) dataToUpdate\.workStartTime = dto\.workStartTime;/g,
  /if \(dto\.workEndTime !== undefined\) dataToUpdate\.workEndTime = dto\.workEndTime;/g,
  /if \(dto\.workingDays !== undefined\) dataToUpdate\.workingDays = typeof dto\.workingDays === 'string' \? dto\.workingDays : JSON\.stringify\(dto\.workingDays\);/g,
  // auto-create client assignments
  /businessUnit: tenant\?\.name \|\| 'Default',/g,
  // duplicate() assignments
  /businessUnit: original\.businessUnit,/g,
];

let original = content;
for (const r of toReplace) {
  content = content.replace(r, '');
}

// Manually replace specific chunks to avoid regex matching errors for multiline
content = content.replace(/let workStartTime =[\s\S]*?workStartTime = '09:00';\n    if \(!workEndTime\) workEndTime = '18:00';\n    if \(!workingDays\) workingDays = '\["Monday","Tuesday","Wednesday","Thursday","Friday"\]';/g, '');

if (content !== original) {
  fs.writeFileSync('src/jobs/jobs.service.ts', content, 'utf-8');
  console.log('Removed dropped properties from jobs.service.ts');
} else {
  console.log('No changes made to jobs.service.ts');
}
