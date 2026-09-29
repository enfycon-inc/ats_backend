const fs = require('fs');

let service = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

// Strip out assignedTo from create
service = service.replace(/assignedTo:\s*dto\.assignedTo\s*\|\|\s*'N\/A',?\s*\n?/g, '');
service = service.replace(/assignedTo:\s*'ALL',?\s*\n?/g, '');
service = service.replace(/if\s*\(dto\.assignedTo\s*!==\s*undefined\)\s*\{\s*await\s*this\.prisma\.job\.update\(\{\s*where:\s*\{\s*id\s*\}\s*,\s*data:\s*\{\s*assignedTo:\s*dto\.assignedTo\s*\}\s*\}\);\s*\}\s*\n?/g, '');
service = service.replace(/if\s*\(dto\.assignedTo\s*!==\s*undefined\)\s*dataToUpdate\.assignedTo\s*=\s*dto\.assignedTo;\s*\n?/g, '');
service = service.replace(/const\s*resolvedPrimaryRecruiterId\s*=\s*await\s*this\.resolveUserUuid\(dto\.primaryRecruiterId\s*\|\|\s*dto\.assignedTo,\s*tenantId\);/g, 'const resolvedPrimaryRecruiterId = await this.resolveUserUuid(dto.primaryRecruiterId, tenantId);');

// assignedTo in approvals
service = service.replace(/const\s*assignedTo\s*=\s*overrides\?\.assignedTo\s*\|\|\s*currentJob\.assignedTo\s*\|\|\s*'All Branch Recruiters';\s*\n?/g, '');
service = service.replace(/assignedTo,\s*\n?/g, '');

// Strip businessUnit from create
service = service.replace(/businessUnit:\s*dto\.businessUnit\s*\|\|\s*tenantName,?\s*\n?/g, '');
service = service.replace(/if\s*\(dto\.businessUnit\s*!==\s*undefined\)\s*dataToUpdate\.businessUnit\s*=\s*dto\.businessUnit;\s*\n?/g, '');
// Handle createClient lookup which uses clientName (wait, that was ats.clients!)
service = service.replace(/clientName:\s*\{\s*equals:\s*normalized,\s*mode:\s*'insensitive'\s*\},?\s*\n?/g, "clientName: { equals: normalized, mode: 'insensitive' }, // Fix me");

// Strip clientName from create (job.clientName)
service = service.replace(/clientName:\s*dto\.clientName\s*\|\|\s*'Internal',?\s*\n?/g, '');
service = service.replace(/clientName:\s*dto\.client\s*\|\|\s*dto\.endClientName\s*\|\|\s*'Direct Client',?\s*\n?/g, '');
service = service.replace(/if\s*\(dto\.clientName\s*!==\s*undefined\)\s*dataToUpdate\.clientName\s*=\s*dto\.clientName;\s*\n?/g, '');

// Strip endClientName from create
service = service.replace(/endClientName:\s*dto\.endClientName\s*\|\|\s*dto\.clientName\s*\|\|\s*'Internal',?\s*\n?/g, '');
service = service.replace(/endClientName:\s*dto\.endClientName\s*\|\|\s*dto\.client\s*\|\|\s*'Direct Client',?\s*\n?/g, '');
service = service.replace(/if\s*\(dto\.endClientName\s*!==\s*undefined\)\s*dataToUpdate\.endClientName\s*=\s*dto\.endClientName;\s*\n?/g, '');

// Handle clientName in client create (ats.clients model!)
service = service.replace(/clientName:\s*normalized,?\s*\n?/g, "client_name: normalized, // FIX ME");
// Wait, Prisma for ats.clients mapped `client_name` to `clientName` in Prisma, wait did it?
// Ah! In `ats.clients`, I dropped `name` from my previous run-migration script check? 
// No, the column is `client_name`. Prisma maps `client_name` to `clientName`. Let's see what Prisma thinks it is.

fs.writeFileSync('src/jobs/jobs.service.ts', service);
console.log('Fixed some TS errors in jobs.service.ts');
