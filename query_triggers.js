const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const t = await p.$queryRawUnsafe(`SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'users'::regclass`);
  console.log(t);
  process.exit(0);
}
run();
