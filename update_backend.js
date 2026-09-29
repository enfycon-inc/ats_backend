const fs = require('fs');
const glob = require('glob'); // Note: we'll just write a quick script without glob using fs.readdirSync if needed, or I can just use sed/regex for specific files.

function replaceInFile(filePath, search, replace) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(filePath, content);
}

// 1. candidates.controller.ts
const candCtrl = 'src/candidates/candidates.controller.ts';
let content = fs.readFileSync(candCtrl, 'utf8');
content = content.replace(/ParseIntPipe/g, 'ParseUUIDPipe');
content = content.replace(/@Param\('id', ParseUUIDPipe\) id: number/g, "@Param('id', ParseUUIDPipe) id: string");
fs.writeFileSync(candCtrl, content);

// 2. recruiter-submissions.controller.ts
const subCtrl = 'src/recruiter-submissions/recruiter-submissions.controller.ts';
content = fs.readFileSync(subCtrl, 'utf8');
content = content.replace(/ParseIntPipe/g, 'ParseUUIDPipe');
content = content.replace(/@Param\('id', ParseUUIDPipe\) id: number/g, "@Param('id', ParseUUIDPipe) id: string");
fs.writeFileSync(subCtrl, content);

// 3. candidates.service.ts
const candSvc = 'src/candidates/candidates.service.ts';
content = fs.readFileSync(candSvc, 'utf8');
content = content.replace(/id: number/g, 'id: string');
content = content.replace(/candidateId: number/g, 'candidateId: string');
fs.writeFileSync(candSvc, content);

// 4. recruiter-submissions.service.ts
const subSvc = 'src/recruiter-submissions/recruiter-submissions.service.ts';
content = fs.readFileSync(subSvc, 'utf8');
content = content.replace(/id: number/g, 'id: string');
content = content.replace(/candidateId: number/g, 'candidateId: string');
fs.writeFileSync(subSvc, content);

console.log('Backend controllers and services updated.');
