const fs = require('fs');

const subCtrl = 'src/recruiter-submissions/recruiter-submissions.controller.ts';
let code = fs.readFileSync(subCtrl, 'utf8');
code = code.replace(/candidateId: candidateId \? parseInt\(candidateId, 10\) : undefined,/g, 'candidateId: candidateId ? candidateId : undefined,');
fs.writeFileSync(subCtrl, code);

const subSvc = 'src/recruiter-submissions/recruiter-submissions.service.ts';
let svcCode = fs.readFileSync(subSvc, 'utf8');
// Fix types in service where necessary
svcCode = svcCode.replace(/candidateId: parseInt\(candidateId, 10\)/g, 'candidateId');
fs.writeFileSync(subSvc, svcCode);

const jobSvc = 'src/jobs/jobs.service.ts';
let jsCode = fs.readFileSync(jobSvc, 'utf8');
jsCode = jsCode.replace(/candidateId: number;/g, 'candidateId: string;');
fs.writeFileSync(jobSvc, jsCode);

console.log('Fixed more types.');
