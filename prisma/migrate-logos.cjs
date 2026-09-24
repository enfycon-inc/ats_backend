// Run on the server hosting the persistent logo folder, after deploying both apps.
// Default is read-only. --apply writes image files, verifies HTTP access, then
// replaces matching base64 values with URLs without overwriting concurrent saves.
const { PrismaService } = require('../dist/prisma/prisma.service');
const { storeTenantLogo } = require('../dist/auth/utils/logo-storage');
const { createHash } = require('node:crypto');

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  try {
    const tenants = await prisma.$queryRawUnsafe("SELECT id, domain, logo_url FROM ats.tenants WHERE logo_url LIKE 'data:image/%'");
    const apply = process.argv.includes('--apply');
    for (const tenant of tenants) {
      if (!apply) {
        console.log({ domain: tenant.domain, encodedCharacters: tenant.logo_url.length, action: 'would migrate' });
        continue;
      }
      const logoUrl = await storeTenantLogo(tenant.id, tenant.logo_url);
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}${logoUrl}`);
      if (!response.ok) throw new Error(`Logo URL unavailable for ${tenant.domain}: HTTP ${response.status}`);
      const expected = Buffer.from(tenant.logo_url.split(',')[1], 'base64');
      const actual = Buffer.from(await response.arrayBuffer());
      if (!actual.equals(expected)) throw new Error(`Served image mismatch for ${tenant.domain}`);
      const count = await prisma.$executeRawUnsafe('UPDATE ats.tenants SET logo_url = $2 WHERE id = $1::uuid AND logo_url = $3', tenant.id, logoUrl, tenant.logo_url);
      console.log({ domain: tenant.domain, logoUrl, bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex'), migrated: count === 1 });
    }
    console.log(`${apply ? 'Migration complete' : 'Dry run complete'}: ${tenants.length} inline logo(s).`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
