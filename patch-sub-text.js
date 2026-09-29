const fs = require('fs');
let content = fs.readFileSync('src/recruiter-submissions/recruiter-submissions.service.ts', 'utf-8');

content = content.replace(/::text/g, '');

fs.writeFileSync('src/recruiter-submissions/recruiter-submissions.service.ts', content, 'utf-8');
console.log('Removed ::text');
