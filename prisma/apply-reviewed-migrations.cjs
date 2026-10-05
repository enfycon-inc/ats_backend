// Explicit operator command: node prisma/apply-reviewed-migrations.cjs
// Only reviewed additive migrations belong in this list. Never run db push in production.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(184725)");
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS ats.reviewed_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    for (const name of ['job-operating-unit.sql']) {
      const applied = await tx.$queryRawUnsafe('SELECT name FROM ats.reviewed_schema_migrations WHERE name=$1', name);
      if (applied.length) continue;
      await tx.$executeRawUnsafe(fs.readFileSync(path.join(__dirname, name), 'utf8'));
      await tx.$executeRawUnsafe('INSERT INTO ats.reviewed_schema_migrations(name) VALUES($1)', name);
      console.log(`Applied reviewed migration: ${name}`);
    }
  });
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
