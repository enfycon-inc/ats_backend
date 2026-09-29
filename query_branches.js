const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const branches = await prisma.branch.findMany({
    where: { tenantId: '737f666b-916a-4e9c-91bd-b2bd37e475d1' }
  });
  console.log("Branches:", branches);
}

main().catch(console.error).finally(() => prisma.$disconnect());
