const { PrismaService } = require('../dist/prisma/prisma.service');
const { AuthQueryService } = require('../dist/auth/services/auth-query.service');
const { AuthTenantService } = require('../dist/auth/services/auth-tenant.service');
async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  try {
    if (process.argv.includes('--inspect')) {
      const query = new AuthQueryService(prisma);
      const tenants = await query.query("SELECT id, name, domain, site_title, length(logo_url) AS logo_characters, updated_at FROM tenants WHERE domain = 'deb'");
      console.log('Saved database branding:', tenants.rows);
      const { AuthUserService } = require('../dist/auth/services/auth-user.service');
      const members = await query.query('SELECT id FROM users WHERE tenant_id = $1 AND email = $2 LIMIT 1', [tenants.rows[0].id, 'imsahadeb@gmail.com']);
      if (!members.rows.length) throw new Error('Member not found in deb tenant');
      const profile = await new AuthUserService(query).getProfile(members.rows[0].id);
      console.log('Fresh member profile branding:', {
        tenantId: profile.tenantId, name: profile.tenant.name,
        siteTitle: profile.tenant.siteTitle, logoCharacters: profile.tenant.logoUrl?.length,
      });
      return;
    }
    await prisma.$transaction(async tx => {
      console.log(await tx.$queryRawUnsafe('SELECT current_database(), current_schema()'));
      const query = new AuthQueryService(tx);
      const tenant = await query.query("SELECT id FROM tenants WHERE domain = 'deb' LIMIT 1");
      const service = new AuthTenantService(query);
      service.logger = { log() {} };
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      const result = await service.updateTenantSettings(tenant.rows[0].id, {
        siteTitle: 'Branding regression test', logoUrl: 'data:image/png;base64,' + png,
        name: 'Deb Technology',
      });
      if (result.site_title !== 'Branding regression test') throw new Error('Title mismatch');
      if (!result.logo_url.startsWith('/public/image/logos/')) throw new Error('Logo was not stored as a link');
      if (process.argv.includes('--verify-http')) {
        const response = await fetch(`http://127.0.0.1:5000${result.logo_url}`);
        if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(Buffer.from(png, 'base64'))) {
          throw new Error('Public logo URL does not return saved image bytes');
        }
        console.log('PASS: public logo URL returns the original PNG bytes');
      }
      JSON.stringify(result);
      const { AuthUserService } = require('../dist/auth/services/auth-user.service');
      const members = await query.query('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [tenant.rows[0].id]);
      if (!members.rows.length) throw new Error('No tenant member to verify profile reload');
      const profile = await new AuthUserService(query).getProfile(members.rows[0].id);
      if (profile.tenant.siteTitle !== result.site_title || profile.tenant.logoUrl !== result.logo_url) {
        throw new Error('Saved branding missing from reloaded profile');
      }
      console.log('PASS: saved logo and title returned by fresh profile read');
      console.log('PASS: full Prisma settings path and JSON serialization');
      throw new Error('ROLLBACK_TEST');
    });
  } catch (e) {
    if (e.message !== 'ROLLBACK_TEST') throw e;
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
