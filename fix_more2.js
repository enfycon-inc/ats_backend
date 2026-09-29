const fs = require('fs');

const subSvc = 'src/recruiter-submissions/recruiter-submissions.service.ts';
let svcCode = fs.readFileSync(subSvc, 'utf8');
svcCode = svcCode.replace(/candidateId\?: number;/g, 'candidateId?: string;');
fs.writeFileSync(subSvc, svcCode);

const bulk = 'src/candidates/bulk-cv.processor.ts';
let bulkCode = fs.readFileSync(bulk, 'utf8');
bulkCode = bulkCode.replace(
  'candidateId: result.candidate.dbId || result.candidate.id || null,',
  'candidateId: (result.candidate.dbId || result.candidate.id) ? String(result.candidate.dbId || result.candidate.id) : null,'
);
fs.writeFileSync(bulk, bulkCode);
console.log('Fixed more.');
