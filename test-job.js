const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const job = await prisma.job.findUnique({
    where: { jobCode: 'VIZ-IND-261001-001' },
    select: { id: true, isCoSourced: true, sharedBranchIds: true, branchId: true, businessUnitId: true }
  });
  console.log(job);
  process.exit(0);
}
run();
