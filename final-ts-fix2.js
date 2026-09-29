const fs = require('fs');

// 1. FIX JOBS SERVICE
let js = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');
js = js.replace(/businessUnit:\s*dto\.businessUnit\s*\|\|\s*tenantName,\n?/g, '');
js = js.replace(/if\s*\(clientCheck\.status/g, 'if (clientCheck && clientCheck.status');
js = js.replace(/\|\|\s*clientCheck\.approvalStatus/g, '|| (clientCheck && clientCheck.approvalStatus)');
js = js.replace(/if\s*\(endClientCheck\.status/g, 'if (endClientCheck && endClientCheck.status');
js = js.replace(/\|\|\s*endClientCheck\.approvalStatus/g, '|| (endClientCheck && endClientCheck.approvalStatus)');
fs.writeFileSync('src/jobs/jobs.service.ts', js);

// 2. FIX CLIENTS SERVICE
let cs = fs.readFileSync('src/clients/clients.service.ts', 'utf8');
cs = cs.replace(/clientName:\s*true,?\n?/g, '');
cs = cs.replace(/\(j\.clientName\s*&&\s*j\.clientName\.toLowerCase\(\)\s*===\s*cNameLower\)\s*\|\|/g, '');
cs = cs.replace(/\(j\.endClientName\s*&&\s*j\.endClientName\.toLowerCase\(\)\s*===\s*cNameLower\)/g, 'false');
cs = cs.replace(/\{\s*clientName:\s*\{\s*equals:\s*client\.clientName,\s*mode:\s*'insensitive'\s*\}\s*\},\n?/g, '');
cs = cs.replace(/\{\s*endClientName:\s*\{\s*equals:\s*client\.clientName,\s*mode:\s*'insensitive'\s*\}\s*\},\n?/g, '');
cs = cs.replace(/client_name:\s*j\.clientName,/g, "client_name: 'N/A',");
cs = cs.replace(/end_client_name:\s*j\.endClientName,/g, "end_client_name: 'N/A',");
fs.writeFileSync('src/clients/clients.service.ts', cs);

console.log('✅ Applied fixes to clients.service.ts and jobs.service.ts');
