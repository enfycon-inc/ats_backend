const fs = require('fs');
const file = 'src/jobs/jobs.service.ts';
let c = fs.readFileSync(file, 'utf8');

const regex = /include:\s*\{\s*job:\s*\{\s*select:\s*\{\s*id:\s*true,\s*jobCode:\s*true,\s*jobTitle:\s*true,\s*isCoSourced:\s*true\s*\}\s*\}/g;
c = c.replace(regex, "include: { job: true");

fs.writeFileSync(file, c);
