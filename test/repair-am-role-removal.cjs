// Apply only the role removals reported for this member. No role definitions are changed.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const userId = 'f8bdcd3f-c327-46ea-a277-678e812d5c74';
const tenantId = '737f666b-916a-4e9c-91bd-b2bd37e475d1';
const branchId = '01141515-78b4-4384-99c3-3dc7ffea4492';
const keepId = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
const oldPrimary = 'b9d3d4c1-662e-452b-aca8-957d783020d8';
const expected = [oldPrimary, '27d2659a-76de-4160-832e-a8bc60a6b6fa', '6c76b41d-12a6-4c09-b750-20482c2a6ee6', keepId];

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const result = await client.query(`SELECT role_id, assigned_role_ids FROM ats.users
      WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND email = $4 ${apply ? 'FOR UPDATE' : ''}`,
      [userId, tenantId, branchId, 'am@deb.com']);
    const user = result.rows[0];
    if (!user) throw new Error('Member identity changed; no update made.');
    if (user.role_id === keepId && JSON.stringify(user.assigned_role_ids) === JSON.stringify([keepId])) {
      console.log('Already corrected: BDM only.');
      await client.query('ROLLBACK');
      return;
    }
    if (user.role_id !== oldPrimary || JSON.stringify([...user.assigned_role_ids].sort()) !== JSON.stringify([...expected].sort())) {
      throw new Error('Assignments changed since inspection; no update made.');
    }
    const role = await client.query('SELECT name FROM ats.custom_roles WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [keepId, tenantId, branchId]);
    if (role.rows[0]?.name !== 'BDM') throw new Error('Retained role changed; no update made.');
    console.log('Requested correction: remove both Branch Admin assignments and Delivery Head; retain BDM.');
    if (apply) {
      await client.query(`UPDATE ats.users SET role_id = $1, assigned_role_ids = $2::uuid[], updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4`, [keepId, [keepId], userId, tenantId]);
      await client.query('COMMIT');
      console.log('Saved: role_id = BDM; assigned_role_ids = [BDM].');
    } else {
      await client.query('ROLLBACK');
      console.log('Read-only preview; use --apply to save.');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
