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

replaceInFile('src/jobs/jobs.service.ts', [
  ['if (clientCheck && (clientCheck.status === \'Pending Approval\' || clientCheck.approvalStatus === \'PENDING_APPROVAL\')) {', 'if (clientCheck?.status === \'Pending Approval\' || clientCheck?.approvalStatus === \'PENDING_APPROVAL\') {'],
  ['if (clientCheck && (clientCheck.status === \'Rejected\' || clientCheck.approvalStatus === \'REJECTED\')) {', 'if (clientCheck?.status === \'Rejected\' || clientCheck?.approvalStatus === \'REJECTED\') {'],
  ['if (endClientCheck && (endClientCheck.status === \'Pending Approval\' || endClientCheck.approvalStatus === \'PENDING_APPROVAL\')) {', 'if (endClientCheck?.status === \'Pending Approval\' || endClientCheck?.approvalStatus === \'PENDING_APPROVAL\') {'],
  ['if (endClientCheck && (endClientCheck.status === \'Rejected\' || endClientCheck.approvalStatus === \'REJECTED\')) {', 'if (endClientCheck?.status === \'Rejected\' || endClientCheck?.approvalStatus === \'REJECTED\') {'],
]);
