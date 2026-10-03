const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const jobs = await prisma.job.findMany({ where: { jobCode: 'VIZ-IND-261001-001' }, select: { id: true, jobTitle: true, recruiterId: true, deletedAt: true } });
  console.log('Jobs with code VIZ-IND-261001-001:', jobs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
