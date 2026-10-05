
const { PrismaClient } = require('@prisma/client');
async function main() {
  const prisma = new PrismaClient();
  try {
    const u = await prisma.('SELECT COUNT(*) FROM ats.users');
    const t = await prisma.('SELECT COUNT(*) FROM ats.tenants');
    console.log('Users:', Number(u[0].count));
    console.log('Tenants:', Number(t[0].count));
  } catch(e) {
    console.error('Error:', e);
  } finally {
    await prisma.();
  }
}
main();
