import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.job.findMany({ 
    select: { id: true, jobTitle: true, businessUnitId: true, createdBy: true, accountManagerId: true }
  });
  console.log(`Total jobs: ${jobs.length}`);
  console.log(jobs);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
