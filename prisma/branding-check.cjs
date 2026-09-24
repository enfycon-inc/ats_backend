const { Client } = require('pg');
const { readFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (process.argv.includes('--apply')) {
      await client.query('BEGIN');
      await client.query(readFileSync(join(__dirname, 'branding.sql'), 'utf8'));
      await client.query('COMMIT');
      console.log('Branding migration applied.');
    }
    const columns = await client.query(`SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'tenants'
      AND column_name IN ('site_title', 'logo_url') ORDER BY column_name`);
    console.log(columns.rows);
    if (process.argv.includes('--verify')) {
      // Exercise the actual settings service; roll back all test changes.
      const { AuthTenantService } = require('../dist/auth/services/auth-tenant.service');
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO ats, public');
      const tenant = await client.query("SELECT id FROM tenants WHERE domain = 'deb' LIMIT 1");
      if (!tenant.rows.length) throw new Error('deb tenant not found');
      const service = new AuthTenantService({ query: (sql, params) => client.query(sql, params) });
      service.logger = { log() {} };
      const logoUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      const result = await service.updateTenantSettings(tenant.rows[0].id, {
        siteTitle: 'Branding regression test', logoUrl,
      });
      if (result.site_title !== 'Branding regression test' || !result.logo_url.startsWith('/public/image/logos/')) {
        throw new Error('Branding save did not round-trip');
      }
      await client.query('ROLLBACK');
      console.log('PASS: title and logo URL round-trip through settings service; database test changes rolled back.');
    }
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
