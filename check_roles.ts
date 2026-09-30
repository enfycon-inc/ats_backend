import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const raw = await prisma.$queryRaw`SELECT roles, assigned_role_ids, requested_role, permissions, system_role FROM ats.users WHERE email = 'am@deb.com'`;
  console.log(raw);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
