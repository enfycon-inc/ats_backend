const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rolesToDelete = await prisma.$queryRawUnsafe(`
    SELECT id, name FROM custom_roles 
    WHERE is_system = true 
    AND name NOT IN ('TENANT_ADMIN', 'SUPER_ADMIN', 'Tenant Admin', 'Super Admin', 'ADMIN', 'Admin')
  `);

  console.log('Roles to delete:', rolesToDelete.map(r => r.name));

  if (rolesToDelete.length === 0) {
    console.log('No roles to delete.');
    return;
  }

  const roleIds = rolesToDelete.map(r => r.id);

  // 1. Unassign from users.role_id
  await prisma.$queryRawUnsafe(`
    UPDATE users SET role_id = NULL WHERE role_id = ANY($1::uuid[])
  `, roleIds);

  // 2. Unassign from users.assigned_role_ids
  for (const rId of roleIds) {
    await prisma.$queryRawUnsafe(`
      UPDATE users 
      SET assigned_role_ids = array_remove(assigned_role_ids, $1::uuid)
      WHERE $1::uuid = ANY(assigned_role_ids)
    `, rId);
  }

  // 3. Delete the roles
  const del = await prisma.$queryRawUnsafe(`
    DELETE FROM custom_roles WHERE id = ANY($1::uuid[])
  `, roleIds);

  console.log(`Deleted ${del} system roles.`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
