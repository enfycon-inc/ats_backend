const fs = require('fs');
let c = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

// Update createJob
const createLookFor = `    const resolvedPrimaryRecruiterId = await this.resolveUserUuid(dto.primaryRecruiterId || dto.assignedTo, tenantId);\r
    const resolvedRecruitmentManagerId = await this.resolveUserUuid(dto.recruitmentManagerId, tenantId);\r
    const resolvedAssignedApproverId = await this.resolveUserUuid(assignedApproverId, tenantId);`;

const createReplaceWith = `    const resolvedPrimaryRecruiterId = await this.resolveUserUuid(dto.primaryRecruiterId || dto.assignedTo, tenantId);\r
    const resolvedRecruitmentManagerId = await this.resolveUserUuid(dto.recruitmentManagerId, tenantId);\r
    const resolvedAssignedApproverId = await this.resolveUserUuid(assignedApproverId, tenantId);\r
    const resolvedAccountManagerId = await this.resolveUserUuid(dto.accountManagerId || ((createdByEmail && createdByEmail !== 'System') ? createdByEmail : null), tenantId);`;

c = c.replace(createLookFor.replace(/\r/g, ''), createReplaceWith.replace(/\r/g, ''));
c = c.replace(createLookFor, createReplaceWith); // just in case it has \r

const amLookFor = `accountManagerId: dto.accountManagerId || ((createdByEmail && createdByEmail !== 'System') ? createdByEmail : null),`;
const amReplaceWith = `accountManagerId: resolvedAccountManagerId || null,`;

c = c.replace(amLookFor, amReplaceWith);

// Also let's check updateJob
const updateJobRegex = /if \(dto\.accountManagerId !== undefined\) dataToUpdate\.accountManagerId = dto\.accountManagerId;/g;
const updateJobReplace = `if (dto.accountManagerId !== undefined) dataToUpdate.accountManagerId = await this.resolveUserUuid(dto.accountManagerId, tenantId);`;
c = c.replace(updateJobRegex, updateJobReplace);

fs.writeFileSync('src/jobs/jobs.service.ts', c);
console.log('✅ Updated jobs.service.ts with resolveUserUuid for accountManagerId');
