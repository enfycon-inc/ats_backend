const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findFirst({ where: { id: '639aaf25-6a6d-4107-9c54-582456d03296' } });
  console.log('Job:', job.jobCode, 'recruiterId:', job.recruiterId);
  const jr = await prisma.jobRecruiter.findMany({ where: { jobId: job.id }, include: { recruiter: { select: { fullName: true } } } });
  console.log('Recruiters in DB:', jr.map(r => r.recruiter?.fullName));
}
main().catch(console.error).finally(() => prisma.$disconnect());
