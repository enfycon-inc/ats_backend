const fs = require('fs');

const serviceFile = 'src/jobs/jobs.service.ts';
let code = fs.readFileSync(serviceFile, 'utf8');

// 1. We fix the Account Manager isolation gate.
// Currently it's:
//     if (isAccountManager && user?.dbId) {
//       // Account manager cannot see jobs posted by other team members
//       sql += ` AND (
//         j.created_by = $${paramIndex}::text 
//         OR LOWER(j.created_by) = LOWER($${paramIndex + 1})
//         OR j.recruitment_manager_id = $${paramIndex}::uuid
//       )`;
//       params.push(user.dbId);
//       params.push(user.email || user.dbId);
//       paramIndex += 2;
//     } else if (!isGlobalOrBranchAdmin && user?.dbId) {

// We will replace this block so Account Managers see their unit's jobs (or branch's jobs) unless "my" filter is applied.
const oldGate = `    if (isAccountManager && user?.dbId) {
      // Account manager cannot see jobs posted by other team members
      sql += \` AND (
        j.created_by = $\${paramIndex}::text 
        OR LOWER(j.created_by) = LOWER($\${paramIndex + 1})
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;
      params.push(user.dbId);
      params.push(user.email || user.dbId);
      paramIndex += 2;
    } else if (!isGlobalOrBranchAdmin && user?.dbId) {`;

const newGate = `    if (isAccountManager && user?.dbId) {
      // Account manager can see ALL unit jobs, so we don't aggressively filter them out here.
      // But we still limit them to their branch/unit which is handled above via targetBranchId / unitScoped.
      // We will handle the "My Jobs" explicitly in the sub-view filters.
    } else if (!isGlobalOrBranchAdmin && !isAccountManager && user?.dbId) {`;

code = code.replace(oldGate, newGate);

// 2. We add handling for `filter === 'my'`
//     if (filter === 'direct' && user?.dbId) {
const oldFilter = `    if (filter === 'direct' && user?.dbId) {`;
const newFilter = `    if (filter === 'my' && user?.dbId) {
      // "My Jobs" view: only show jobs created by self
      sql += \` AND (
        j.created_by = $\${paramIndex}::text 
        OR LOWER(j.created_by) = LOWER($\${paramIndex + 1})
        OR j.recruitment_manager_id = $\${paramIndex}::uuid
      )\`;
      params.push(user.dbId);
      params.push(user.email || user.dbId);
      paramIndex += 2;
    } else if (filter === 'direct' && user?.dbId) {`;

code = code.replace(oldFilter, newFilter);

fs.writeFileSync(serviceFile, code);
console.log('Fixed backend jobs service.');
