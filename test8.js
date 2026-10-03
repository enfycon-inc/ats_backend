const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findFirst({ where: { jobCode: 'VIZ-IND-261001-001' } });
  const jr = await prisma.jobRecruiter.findMany({ where: { jobId: job.id }, include: { recruiter: { select: { fullName: true } } } });
  console.log('Recruiters in DB for VIZ-IND-261001-001:', jr.map(r => r.recruiter?.fullName));
}
main().catch(console.error).finally(() => prisma.$disconnect());
