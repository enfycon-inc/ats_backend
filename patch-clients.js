const fs = require('fs');

function replaceInFile(path, replacements) {
  let content = fs.readFileSync(path, 'utf-8');
  let original = content;
  for (const [search, replace] of replacements) {
    if (search instanceof RegExp) {
      content = content.replace(search, replace);
    } else {
      content = content.split(search).join(replace);
    }
  }
  if (content !== original) {
    fs.writeFileSync(path, content, 'utf-8');
    console.log(`Updated ${path}`);
  }
}

// 1. clients.service.ts
replaceInFile('src/clients/clients.service.ts', [
  ['clientName: true,\n          endClientName: true,', ''], // Remove from job select
  ['clientName: true,', ''], // fallback if separate
  ['endClientName: true,', ''], // fallback if separate
  ['(j.clientName && j.clientName.toLowerCase() === cNameLower) ||', '(j.clientId === c.id) ||'],
  ['(j.endClientName && j.endClientName.toLowerCase() === cNameLower)', '(j.endClientId === c.id)'],
  ['client_name: j.clientName,', ''], // formatClientJobs logic ? If client_name is expected by frontend on jobs, it's missing. Wait, formatClientJobs maps Job to frontend format. We can use clientRef?.name or just leave it empty.
  ['end_client_name: j.endClientName,', ''],
  [/client_name: j\.clientName,/g, 'client_name: j.clientRef?.clientName || j.clientId,'],
  [/end_client_name: j\.endClientName,/g, 'end_client_name: j.endClientRef?.clientName || j.endClientId,'],
]);

// 2. recruiter-submissions.service.ts
replaceInFile('src/recruiter-submissions/recruiter-submissions.service.ts', [
  ['clientName: \'N/A\',', ''], // In submission defaults
  ['clientName: row.client_name || row.clientName,', 'clientName: row.client?.clientName || row.client_id,'],
  ['endClientName: row.end_client_name || row.endClientName,', 'endClientName: row.end_client?.clientName || row.end_client_id,'],
  // Also check `assignedTo: true` or `workingDays: true` in recruiter submissions if any
]);

console.log("Replacements done for clients and recruiter submissions.");
