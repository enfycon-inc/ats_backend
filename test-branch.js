const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const b = await prisma.branch.findMany({ select: { id: true, name: true }});
  console.log(b);
  process.exit(0);
}
run();
