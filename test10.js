const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { id: { in: ['e588e4e4-c60d-4a9e-8aae-7ccf1c9bb6de', '38714d0b-8262-493d-82f1-9df34eb54ab8'] } }, select: { id: true, fullName: true } });
  console.log('Users:', users);
}
main().catch(console.error).finally(() => prisma.$disconnect());
