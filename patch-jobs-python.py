import os

with open('src/jobs/jobs.service.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(len(lines)):
    # Fix the SELECT queries to include client names
    if "b.code AS branch_code" in lines[i] and "FROM ats.jobs j" in lines[i+1]:
        lines[i] = "             b.code AS branch_code,\n             cl.client_name AS mapped_client_name,\n             ecl.client_name AS mapped_end_client_name,\n             bu.name AS mapped_business_unit_name\n"
        
    if "LEFT JOIN ats.branches b ON b.id = j.branch_id" in lines[i] and "WHERE j.tenant_id = $1" in lines[i+1]:
        lines[i] = "      LEFT JOIN ats.branches b ON b.id = j.branch_id\n      LEFT JOIN ats.clients cl ON cl.id = j.client_id\n      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id\n      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id\n"

    # Fix mapRowToProfile to use mapped_client_name
    if "client: row.client?.clientName || row.client_id," in lines[i]:
        lines[i] = "      client: row.mapped_client_name || row.client_id,\n"
    if "endClientName: row.end_client?.clientName || row.end_client_id," in lines[i]:
        lines[i] = "      endClientName: row.mapped_end_client_name || row.end_client_id,\n"
    if "businessUnit: row.business_unit ?? row.businessUnit ?? ''," in lines[i]:
        lines[i] = "      businessUnit: row.mapped_business_unit_name || row.business_unit_id || '',\n"

in_am_block = False
for i in range(len(lines)):
    if "if (isAccountManager && user?.dbId) {" in lines[i]:
        in_am_block = True
    if "} else if (!isGlobalOrBranchAdmin && user?.dbId) {" in lines[i]:
        in_am_block = False

    if in_am_block:
        if "// Account manager cannot see jobs posted by other team members" in lines[i]:
            lines[i] = "      // Account manager sees all jobs in their business unit\n"
        if "sql += ` AND (" in lines[i]:
            lines[i] = "      if (user.businessUnitId) {\n"
            lines[i+1] = "        sql += ` AND j.business_unit_id = $${paramIndex}::uuid`;\n"
            lines[i+2] = "        params.push(user.businessUnitId);\n"
            lines[i+3] = "      } else {\n"
            lines[i+4] = "        sql += ` AND (j.created_by = $${paramIndex}::uuid OR j.account_manager_id = $${paramIndex}::uuid OR j.recruitment_manager_id = $${paramIndex}::uuid)`;\n"
            lines[i+5] = "        params.push(user.dbId);\n"
            lines[i+6] = "      }\n"
            lines[i+7] = "" 
            lines[i+8] = ""
            lines[i+9] = ""
            lines[i+10] = ""

with open('src/jobs/jobs.service.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print("done")
