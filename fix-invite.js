const fs = require('fs');
let c = fs.readFileSync('src/auth/services/auth-invite.service.ts', 'utf8');

c = c.replace(
  /const systemRole = \(dto\.systemRole \|\| 'RECRUITER'\)\.toUpperCase\(\);\n\s*const sysRoleRes = await this\.authQuery\.query\('SELECT id FROM system_roles WHERE system_key = \$1 LIMIT 1', \[systemRole\]\);\n\s*const systemRoleId = sysRoleRes\.rows\.length > 0 \? \(sysRoleRes\.rows\[0\] as any\)\.id : null;\n\n\s*let roleId = dto\.roleId \|\| null;\n\s*if \(\!roleId\) \{\n\s*const defaultRoleRes = await this\.authQuery\.query\(\n\s*`SELECT cr\.id FROM custom_roles cr\n\s*LEFT JOIN system_roles sr ON cr\.system_role_id = sr\.id\n\s*WHERE cr\.tenant_id = \\\$1 AND \(sr\.system_key = \\\$2 OR cr\.name = \\\$2\) LIMIT 1`,\n\s*\[tenantId, systemRole\]\n\s*\);\n\s*if \(defaultRoleRes\.rows\.length > 0\) roleId = \(defaultRoleRes\.rows\[0\] as any\)\.id;\n\s*\}/,
  `const systemRole = dto.systemRole ? dto.systemRole.toUpperCase() : null;
    let systemRoleId = null;
    if (systemRole) {
      const sysRoleRes = await this.authQuery.query('SELECT id FROM system_roles WHERE system_key = $1 LIMIT 1', [systemRole]);
      systemRoleId = sysRoleRes.rows.length > 0 ? (sysRoleRes.rows[0] as any).id : null;
    }

    let roleId = dto.roleId || null;
    if (!roleId && systemRole) {
      const defaultRoleRes = await this.authQuery.query(
        \`SELECT cr.id FROM custom_roles cr
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE cr.tenant_id = $1 AND (sr.system_key = $2 OR cr.name = $2) LIMIT 1\`,
        [tenantId, systemRole]
      );
      if (defaultRoleRes.rows.length > 0) roleId = (defaultRoleRes.rows[0] as any).id;
    }`
);

fs.writeFileSync('src/auth/services/auth-invite.service.ts', c);
console.log("Fixed auth-invite RECRUITER default");
