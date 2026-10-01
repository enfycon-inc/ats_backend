const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const branchesList = await prisma.branch.findMany({
    where: { tenantId: '737f666b-916a-4e9c-91bd-b2bd37e475d1' },
    include: {
      users: {
        where: { customRole: { systemRole: { systemKey: 'BRANCH_ADMIN' } } },
        select: { id: true, fullName: true, email: true },
      },
    },
  });
  
  const formatted = branchesList.map(b => {
     return {
        id: b.id,
        name: b.name,
        managers: b.users?.map(m => ({ id: m.id, fullName: m.fullName, email: m.email })) || []
     };
  });
  console.log(JSON.stringify(formatted, null, 2));
}
test().catch(console.error).finally(() => prisma.$disconnect());
