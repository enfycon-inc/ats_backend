const fs = require('fs');
const file = 'src/recruiter-submissions/dtos/create-submission.dto.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/candidateId: number;/g, 'candidateId: string;');
code = code.replace(/@IsNumber\(\)/g, '@IsString()'); // In case it has IsNumber
fs.writeFileSync(file, code);
console.log('Fixed DTO.');
