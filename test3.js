const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const job = await prisma.job.findUnique({ where: { id: '639aaf25-6a6d-4107-9c54-582456d03296' }, select: { recruiterId: true } });
  if (job) {
    const user = await prisma.user.findUnique({ where: { id: job.recruiterId }, select: { fullName: true } });
    console.log('RecruiterId user:', user);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
