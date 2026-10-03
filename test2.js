const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findFirst({ select: { id: true, assignedTo: true, recruiterId: true } });
  console.log(job);
}
main().catch(console.error).finally(() => prisma.$disconnect());
