const fs = require('fs');
const utils = fs.readFileSync('../ats_frontend_main/app/(dashboard)/job-posting/lib/job-table-utils.ts', 'utf-8');

// strip out typescript types and imports to run it
let jsCode = utils
  .replace(/import .*/g, '')
  .replace(/export interface .*?\{[^}]+\}/gs, '')
  .replace(/export function getAssignedPersonDisplay\(job: any\): any/g, 'function getAssignedPersonDisplay(job)')
  .replace(/export function /g, 'function ')
  .replace(/: [a-zA-Z<>\[\]]+/g, '')
  .replace(/ as any/g, '');

const testCode = `
${jsCode}

const job = {
  id: '639aaf25-6a6d-4107-9c54-582456d03296',
  recruiterId: '38714d0b-8262-493d-82f1-9df34eb54ab8',
  recruiter: 'Ananya Reddy, Recruiter One, Recruiter Two',
  recruiterIds: [
    '990dfd65-a084-47bd-89db-0845dff5c14f',
    '19536aad-971c-411c-adb4-b2ebcb908db9',
    'aea9b4c4-f600-44a7-b136-7b4574421ffd'
  ]
};

console.log(JSON.stringify(getAssignedPersonDisplay(job), null, 2));
`;
fs.writeFileSync('test12.js', testCode);
