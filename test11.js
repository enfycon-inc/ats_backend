const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const ananya = await prisma.user.findFirst({ where: { fullName: 'Ananya Reddy' }, select: { podId: true } });
  console.log('Ananya podId:', ananya.podId);
}
main().catch(console.error).finally(() => prisma.$disconnect());
