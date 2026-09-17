const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const candidate = await prisma.candidate.findUnique({ where: { id: 4 } });
  console.log(candidate);
}
main().catch(console.error).finally(() => prisma.\());
