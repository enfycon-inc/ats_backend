import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const am = await prisma.user.findFirst({ where: { email: 'am@deb.com' } });
  console.log('User am@deb.com:');
  console.log('businessUnitId:', am?.businessUnitId);
  console.log('podId:', am?.podId);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
