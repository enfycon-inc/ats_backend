const fs = require('fs');

const file1 = 'src/candidates/bulk-cv.processor.ts';
let code1 = fs.readFileSync(file1, 'utf8');
code1 = code1.replace(
  'candidateId: Number(result.candidate.dbId || result.candidate.id) || null,',
  'candidateId: result.candidate.dbId || result.candidate.id || null,'
);
fs.writeFileSync(file1, code1);

const file2 = 'src/recruiter-submissions/recruiter-submissions.service.ts';
let code2 = fs.readFileSync(file2, 'utf8');
code2 = code2.replace(/candidateId: parseInt\(dto\.candidateId, 10\)/g, 'candidateId: dto.candidateId');
// Looking at line 103 and 149 in recruiter-submissions.service.ts
// Let's just do a regex for them.
code2 = code2.replace(/candidateId: parseInt\(candidateId, 10\)/g, 'candidateId');
code2 = code2.replace(/candidateId: Number\(dto.candidateId\)/g, 'candidateId: dto.candidateId');
fs.writeFileSync(file2, code2);
console.log('Fixed type casts.');
