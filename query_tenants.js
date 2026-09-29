const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, domain: true }
  });
  console.log("Tenants:", tenants);
}

main().catch(console.error).finally(() => prisma.$disconnect());
