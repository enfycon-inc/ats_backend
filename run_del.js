const { Client } = require('pg');

async function testDelete() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rolesRes = await client.query("SELECT id, name, tenant_id, is_system FROM custom_roles WHERE is_system = false");
  console.log('Custom roles found:', rolesRes.rows);

  if (rolesRes.rows.length > 0) {
    const roleToDel = rolesRes.rows[0];
    console.log('Attempting to delete role:', roleToDel);

    const { AuthService } = require('/app/dist/src/auth/auth.service');
    const service = Object.create(AuthService.prototype);
    service.db = { query: (q, params) => client.query(q, params), getClient: () => client };

    try {
      const res = await service.deleteCustomRole(roleToDel.tenant_id, roleToDel.id);
      console.log('DELETE SUCCESSFUL RESULT:', res);
    } catch (err) {
      console.error('DELETE ERROR CAUGHT:', err);
    }
  }

  await client.end();
}

testDelete().catch(console.error);
