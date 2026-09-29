const fs = require('fs');
const file = 'src/jobs/jobs.service.ts';
let code = fs.readFileSync(file, 'utf8');

const oldGate = `    if (isAccountManager && user?.dbId) {
      // Account manager can see ALL unit jobs, so we don't aggressively filter them out here.
      // But we still limit them to their branch/unit which is handled above via targetBranchId / unitScoped.
      // We will handle the "My Jobs" explicitly in the sub-view filters.
    } else if (!isGlobalOrBranchAdmin && !isAccountManager && user?.dbId) {`;

const newGate = `    if (isAccountManager && user?.dbId) {
      // Account manager can see ALL unit jobs, so we don't aggressively filter them out here.
      // Explicitly enforce Business Unit scoping if the user belongs to a BU.
      if (user?.businessUnitId) {
        sql += ' AND j.business_unit_id = $' + paramIndex;
        params.push(user.businessUnitId);
        paramIndex++;
      }
    } else if (!isGlobalOrBranchAdmin && !isAccountManager && user?.dbId) {`;

code = code.replace(oldGate, newGate);
fs.writeFileSync(file, code);
console.log('Fixed backend BU scoping for AM.');
