const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const jobs = await prisma.job.findMany({ where: { jobTitle: { contains: 'Application Programmer test' } }, select: { id: true, jobTitle: true, recruiterId: true } });
  for (const job of jobs) {
    const recruiters = await prisma.jobRecruiter.findMany({ where: { jobId: job.id }, include: { recruiter: { select: { fullName: true } } } });
    console.log(`Job: ${job.id} | Title: ${job.jobTitle} | Recruiters:`, recruiters.map(r => r.recruiter.fullName));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
