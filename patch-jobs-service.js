const fs = require('fs');
let c = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

// Interface replacements
c = c.replace(/\s*assignedTo: string;\r?\n/g, '\n');
c = c.replace(/\s*assignedApproverRole\?: string \| null;\r?\n/g, '\n');
c = c.replace(/\s*workStartTime\?: string;\r?\n/g, '\n');
c = c.replace(/\s*workEndTime\?: string;\r?\n/g, '\n');
c = c.replace(/\s*workingDays\?: string\[\];\r?\n/g, '\n');

// Job Create dto extraction replacements
c = c.replace(/\s*let assignedApproverRole = dto\.assignedApproverRole \|\| null;\r?\n/g, '\n');
c = c.replace(/\s*assignedApproverRole = 'DESIGNATED_REVIEWER';\r?\n/g, '\n');
c = c.replace(/\s*assignedApproverRole = assignedApproverRole \|\| 'POD_LEAD';\r?\n/g, '\n');
c = c.replace(/\s*assignedApproverRole = assignedApproverRole \|\| 'BRANCH_ADMIN';\r?\n/g, '\n');
c = c.replace(/\s*assignedApproverRole,\r?\n/g, '\n'); // in Prisma.job.create

c = c.replace(/const resolvedPrimaryRecruiterId = await this\.resolveUserUuid\(dto\.recruiterId \|\| dto\.assignedTo, tenantId\);/g, 'const resolvedPrimaryRecruiterId = await this.resolveUserUuid(dto.recruiterId, tenantId);');

// `findAllJobs` mapped property replacements
c = c.replace(/\s*assignedTo: row\.assigned_to \?\? row\.assignedTo \?\? 'N\/A',\r?\n/g, '\n');
c = c.replace(/\s*assignedApproverRole: row\.assigned_approver_role \?\? row\.assignedApproverRole \?\? null,\r?\n/g, '\n');
c = c.replace(/\s*workStartTime: row\.work_start_time \?\? row\.workStartTime \?\? '09:00',\r?\n/g, '\n');
c = c.replace(/\s*workEndTime: row\.work_end_time \?\? row\.workEndTime \?\? '18:00',\r?\n/g, '\n');
c = c.replace(/\s*const workingDaysRaw = row\.working_days \?\? row\.workingDays;\r?\n/g, '\n');

// The workingDays logic is multiline, let's use a regex that matches the try catch block
c = c.replace(/\s*workingDays: \(\(\) => \{[\s\S]*?\}\)\(\),/g, '');

// The `My Jobs` filters checking assignedTo is NULL
const assignedToNullSQL = `          AND (
            j.assigned_to IS NULL 
            OR TRIM(j.assigned_to) = '' 
            OR UPPER(TRIM(j.assigned_to)) IN ('UNASSIGNED', 'NONE', 'N/A')
          )`;
c = c.replace(assignedToNullSQL, '');

// Also the overrides parameter
c = c.replace(/overrides\?: \{ assignedTo\?: string; recruiterId\?: string; podId\?: string \}/g, 'overrides?: { recruiterId?: string; podId?: string }');
c = c.replace(/if \(dto\.assignedTo !== undefined\) \{/g, 'if (false) {'); // nullify it if we can't find exact end

fs.writeFileSync('src/jobs/jobs.service.ts', c);
console.log('Fixed jobs.service.ts part 1');
