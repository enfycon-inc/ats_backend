// Opt in only against an empty disposable PostgreSQL database ending in _test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const url = process.env.POD_DELETE_TEST_DATABASE_URL;

test('assigned pod restriction preserves links and rolls back member changes during concurrent assignment', { skip: !url }, async () => {
  assert.match(new URL(url).pathname, /_test$/i, 'Use an empty disposable test database');
  const admin = new Client({ connectionString: url });
  const second = new Client({ connectionString: url });
  let ownedSchema = false;
  const migration = fs.readFileSync('prisma/migrations/20261022130000_restrict_assigned_pod_deletion/migration.sql', 'utf8');
  const rollback = fs.readFileSync('prisma/rollback/restrict-assigned-pod-deletion.sql', 'utf8');
  const waitForLock = async (observer, pid) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
      if (result.rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('Concurrent request did not reach the expected foreign-key lock');
  };
  try {
    await admin.connect();
    await second.connect();
    await admin.query("SET statement_timeout='10s'");
    await second.query("SET statement_timeout='10s'");
    assert.equal((await admin.query("SELECT to_regnamespace('ats') AS existing")).rows[0].existing, null, 'Database must not contain the application schema');
    await admin.query('CREATE SCHEMA ats');
    ownedSchema = true;
    await admin.query(`CREATE TABLE ats.pods(id integer PRIMARY KEY);
      CREATE TABLE ats.jobs(id integer PRIMARY KEY);
      CREATE TABLE ats.job_pods(job_id integer REFERENCES ats.jobs(id) ON DELETE CASCADE, pod_id integer,
        PRIMARY KEY(job_id,pod_id), CONSTRAINT job_pods_pod_id_fkey FOREIGN KEY(pod_id) REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE CASCADE);
      CREATE TABLE ats.users(id integer PRIMARY KEY,pod_id integer REFERENCES ats.pods(id) ON DELETE SET NULL,is_lead boolean);
      INSERT INTO ats.pods VALUES(1),(2);
      INSERT INTO ats.jobs VALUES(1),(2);
      INSERT INTO ats.users VALUES(1,1,true);`);
    await admin.query(migration);
    assert.equal((await admin.query("SELECT confdeltype FROM pg_constraint WHERE conname='job_pods_pod_id_fkey' AND conrelid='ats.job_pods'::regclass")).rows[0].confdeltype, 'r');
    await admin.query('INSERT INTO ats.job_pods VALUES(1,1)');
    await assert.rejects(admin.query('DELETE FROM ats.pods WHERE id=1'), { code: '23503' });
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM ats.job_pods')).rows[0].count, 1);
    // Deleting the job must still clean up its links.
    await admin.query('DELETE FROM ats.jobs WHERE id=1');
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM ats.job_pods')).rows[0].count, 0);

    const adminPid = (await admin.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // Assignment wins after deletion has observed zero jobs.
    await admin.query('BEGIN');
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM ats.job_pods WHERE pod_id=1')).rows[0].count, 0);
    await second.query('BEGIN');
    await second.query('INSERT INTO ats.job_pods VALUES(2,1)');
    await admin.query('UPDATE ats.users SET pod_id=NULL,is_lead=false WHERE id=1');
    const failedDelete = assert.rejects(admin.query('DELETE FROM ats.pods WHERE id=1'), { code: '23503' });
    await waitForLock(second, adminPid);
    await second.query('COMMIT');
    await failedDelete;
    await admin.query('ROLLBACK');
    assert.deepEqual((await admin.query('SELECT pod_id,is_lead FROM ats.users WHERE id=1')).rows[0], { pod_id: 1, is_lead: true });
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM ats.job_pods WHERE pod_id=1')).rows[0].count, 1);

    // Deletion wins: the concurrent assignment must fail, never create an orphan.
    await admin.query('BEGIN');
    await admin.query('DELETE FROM ats.pods WHERE id=2');
    const failedAssignment = assert.rejects(second.query('INSERT INTO ats.job_pods VALUES(2,2)'), { code: '23503' });
    await waitForLock(admin, secondPid);
    await admin.query('COMMIT');
    await failedAssignment;
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM ats.job_pods WHERE pod_id=2')).rows[0].count, 0);
    await admin.query(rollback);
    assert.equal((await admin.query("SELECT confdeltype FROM pg_constraint WHERE conname='job_pods_pod_id_fkey' AND conrelid='ats.job_pods'::regclass")).rows[0].confdeltype, 'c');
  } finally {
    await admin.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    await second.end().catch(() => {});
    if (ownedSchema) await admin.query('DROP SCHEMA ats CASCADE');
    await admin.end();
  }
});
