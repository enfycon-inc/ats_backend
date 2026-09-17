const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const role = await prisma.customRole.findFirst({ select: { name: true, permissions: true } });
  console.log('Role Permissions:', role);
}
main().finally(() => prisma.$disconnect());
