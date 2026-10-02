const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const units = await prisma.businessUnit.findMany({
    include: {
      marketSegment: true,
      branch: true
    }
  });
  console.dir(units, { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
