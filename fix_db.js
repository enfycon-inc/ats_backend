const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.candidate.update({
    where: { id: 4 },
    data: { deletedAt: null }
  });
  console.log("Restored:", result.id);
}
main().catch(console.error).finally(() => prisma.$disconnect());

