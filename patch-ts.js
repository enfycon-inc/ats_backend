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
  ['{ clientName: { equals: client.clientName, mode: \'insensitive\' } },', '{ clientId: client.id },'],
  ['{ endClientName: { equals: client.clientName, mode: \'insensitive\' } },', '{ endClientId: client.id },'],
  ['clientName: client.clientName,', 'clientName: \'\','],
]);

// 2. jobs.service.ts
replaceInFile('src/jobs/jobs.service.ts', [
  ['timingSnapshotAt: new Date(),', ''],
  ['endClientName: row.end_client?.clientName || row.end_client_id,', ''], // wait, let's remove from JobProfile entirely
  ['if (clientCheck.status === \'Pending Approval\' || clientCheck.approvalStatus === \'PENDING_APPROVAL\') {', 'if (clientCheck && (clientCheck.status === \'Pending Approval\' || clientCheck.approvalStatus === \'PENDING_APPROVAL\')) {'],
  ['throw new BadRequestException(`Cannot activate job requisition: Client "${clientCheck.clientName}" is pending approval. The client must be approved before jobs can go live.`);', 'throw new BadRequestException(`Cannot activate job requisition: Client is pending approval. The client must be approved before jobs can go live.`);'],
  ['if (clientCheck.status === \'Rejected\' || clientCheck.approvalStatus === \'REJECTED\') {', 'if (clientCheck && (clientCheck.status === \'Rejected\' || clientCheck.approvalStatus === \'REJECTED\')) {'],
  ['throw new BadRequestException(`Cannot activate job requisition: Client "${clientCheck.clientName}" was rejected. Please reactivate or approve the client first.`);', 'throw new BadRequestException(`Cannot activate job requisition: Client was rejected. Please reactivate or approve the client first.`);'],
  ['if (endClientCheck.status === \'Pending Approval\' || endClientCheck.approvalStatus === \'PENDING_APPROVAL\') {', 'if (endClientCheck && (endClientCheck.status === \'Pending Approval\' || endClientCheck.approvalStatus === \'PENDING_APPROVAL\')) {'],
  ['throw new BadRequestException(`Cannot activate job requisition: End Client "${endClientCheck.clientName}" is pending approval. The client must be approved first.`);', 'throw new BadRequestException(`Cannot activate job requisition: End Client is pending approval. The client must be approved first.`);'],
  ['if (endClientCheck.status === \'Rejected\' || endClientCheck.approvalStatus === \'REJECTED\') {', 'if (endClientCheck && (endClientCheck.status === \'Rejected\' || endClientCheck.approvalStatus === \'REJECTED\')) {'],
  ['throw new BadRequestException(`Cannot activate job requisition: End Client "${endClientCheck.clientName}" was rejected.`);', 'throw new BadRequestException(`Cannot activate job requisition: End Client was rejected.`);'],
]);

console.log("Replacements done for TS errors");
