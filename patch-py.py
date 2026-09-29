import os

with open('src/jobs/jobs.service.ts', 'r') as f:
    lines = f.readlines()

in_am = False
in_my = False

for i in range(len(lines)):
    line = lines[i]
    if 'if (isAccountManager && user?.dbId) {' in line:
        in_am = True
    if '} else if (!isGlobalOrBranchAdmin && user?.dbId) {' in line:
        in_am = False
        
    if in_am:
        if 'j.created_by =' in line and '::text' in line:
            lines[i] = '        j.created_by = $${paramIndex}::uuid \n'
        if 'OR j.recruitment_manager_id = $${paramIndex}::uuid' in line:
            lines[i] = '        OR j.account_manager_id = $${paramIndex}::uuid\n        OR j.recruitment_manager_id = $${paramIndex}::uuid\n'
            
    if "if (filter === 'my' && user?.dbId) {" in line:
        in_my = True
    if "} else if (filter === 'direct' && user?.dbId) {" in line:
        in_my = False
        
    if in_my:
        if 'j.created_by = ${paramIndex}::uuid' in line:
            lines[i] = '        j.created_by = $${paramIndex}::uuid \n'
        if 'OR j.account_manager_id = ${paramIndex}::uuid' in line:
            lines[i] = '        OR j.account_manager_id = $${paramIndex}::uuid \n'
        if 'OR j.recruitment_manager_id = ${paramIndex}::uuid' in line:
            lines[i] = '        OR j.recruitment_manager_id = $${paramIndex}::uuid\n'

with open('src/jobs/jobs.service.ts', 'w') as f:
    f.writelines(lines)

print("Fixed")
