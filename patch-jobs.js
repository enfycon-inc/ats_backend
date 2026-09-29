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
  ['clientName: dto.client || dto.endClientName || \'Direct Client\',', ''],
  ['endClientName: dto.endClientName || dto.client || \'Direct Client\',', ''],
  ['if (dto.client !== undefined) dataToUpdate.clientName = dto.client;', ''],
  ['if (dto.endClientName !== undefined) dataToUpdate.endClientName = dto.endClientName;', ''],
  ['endClientName: original.endClientName || original.client,', ''], // in duplicate()
  ['endClientName: string;', ''], // in Job interface definition if present
  ['client: row.client_name ?? row.clientName,', 'client: row.client?.clientName || row.client_id,'],
  ['endClientName: row.end_client_name ?? row.endClientName ?? row.client_name ?? row.clientName,', 'endClientName: row.end_client?.clientName || row.end_client_id,'],
]);
