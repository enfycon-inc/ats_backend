const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const branches = await prisma.branch.findMany({
    where: { tenantId: '737f666b-916a-4e9c-91bd-b2bd37e475d1', id: 'd83489d8-3fb5-4d0f-a2f8-5a7d09ea720c' },
    include: {
      users: {
        where: { customRole: { systemRole: { systemKey: 'BRANCH_ADMIN' } } },
        select: { id: true, fullName: true, email: true },
      }
    }
  });
  console.log(JSON.stringify(branches, null, 2));
}
test().catch(console.error).finally(() => prisma.$disconnect());
