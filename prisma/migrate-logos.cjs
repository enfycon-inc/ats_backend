// Run on the host owning the persistent logo volume, after schema/app deployment.
// Default: inspect and calculate optimized sizes. --apply: back up old references,
// write and HTTP-verify optimized images, then compare-and-swap each reference.
const { PrismaService } = require('../dist/prisma/prisma.service');
const { storeOptimizedLogo, optimizeLogo, logoDirectory, LOGO_URL_PREFIX } = require('../dist/auth/utils/logo-storage');
const { readFile, appendFile } = require('node:fs/promises');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const apply = process.argv.includes('--apply');
  const backup = join(logoDirectory(), `.optimization-backup-${Date.now()}.jsonl`);
  try {
    const tenants = await prisma.$queryRawUnsafe('SELECT id, domain, logo_url, login_logo_url FROM ats.tenants WHERE logo_url IS NOT NULL OR login_logo_url IS NOT NULL');
    for (const tenant of tenants) {
      for (const [column, purpose] of [['logo_url', 'site'], ['login_logo_url', 'login']]) {
        const original = tenant[column];
        if (!original) continue;
        try {
          let bytes;
          const inline = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(original);
          if (inline) bytes = Buffer.from(inline[2], 'base64');
          else {
            const prefix = `${LOGO_URL_PREFIX}/${tenant.id}/`;
            const filename = original.slice(prefix.length);
            if (!original.startsWith(prefix) || !/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(filename)) throw new Error('Not a tenant-owned logo path');
            bytes = await readFile(join(logoDirectory(), tenant.id, filename));
          }
          if (bytes.length > 2 * 1024 * 1024) throw new Error('Legacy logo exceeds 2 MB');
          const optimized = await optimizeLogo(bytes, purpose);
          const next = `${LOGO_URL_PREFIX}/${tenant.id}/${createHash('sha256').update(optimized).digest('hex')}.webp`;
          if (next === original) continue;
          if (!apply) {
            console.log({ domain: tenant.domain, purpose, originalBytes: bytes.length, optimizedBytes: optimized.length, action: 'would optimize' });
            continue;
          }
          const url = await storeOptimizedLogo(tenant.id, bytes, purpose);
          const response = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}${url}`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(optimized)) throw new Error('Served logo verification failed');
          await appendFile(backup, JSON.stringify({ tenantId: tenant.id, column, original, replacement: url }) + '\n', { mode: 0o600 });
          // column is selected exclusively from the fixed allowlist above.
          const changed = await prisma.$executeRawUnsafe(`UPDATE ats.tenants SET ${column} = $2, updated_at = NOW() WHERE id = $1::uuid AND ${column} = $3`, tenant.id, url, original);
          console.log({ domain: tenant.domain, purpose, bytes: optimized.length, updated: changed === 1 });
        } catch (error) {
          process.exitCode = 1;
          console.error({ domain: tenant.domain, purpose, error: error.message });
        }
      }
    }
    if (apply) console.log(`Original references backed up to ${backup}`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
