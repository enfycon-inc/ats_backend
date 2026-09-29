const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const t = await prisma.branch.findMany({ where: { tenantId: '737f666b-916a-4e9c-91bd-b2bd37e475d1' } });
  console.log('Branches for Deb Tech:', t.length);
}
run().finally(() => prisma.$disconnect());
