require('dotenv').config();
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await client.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Drop constraints
    console.log('Dropping constraints...');
    await client.query(`ALTER TABLE "ats"."candidates" DROP CONSTRAINT IF EXISTS "candidates_resume_record_id_fkey";`);
    await client.query(`ALTER TABLE "ats"."recruiter_submissions" DROP CONSTRAINT IF EXISTS "recruiter_submissions_candidate_id_fkey";`);
    await client.query(`ALTER TABLE "ats"."bulk_upload_items" DROP CONSTRAINT IF EXISTS "bulk_upload_items_candidate_id_fkey";`);
    // NOTE: mass_mail schema for recipients
    await client.query(`ALTER TABLE "mass_mail"."recipients" DROP CONSTRAINT IF EXISTS "recipients_candidate_id_fkey";`).catch(() => {});

    // 2. Change Primary Keys
    console.log('Migrating Primary Keys...');
    await client.query(`ALTER TABLE "ats"."resumes" ALTER COLUMN id DROP DEFAULT;`);
    await client.query(`ALTER TABLE "ats"."resumes" ALTER COLUMN id SET DATA TYPE UUID USING (LPAD(id::text, 32, '0')::uuid);`);
    await client.query(`ALTER TABLE "ats"."resumes" ALTER COLUMN id SET DEFAULT gen_random_uuid();`);

    await client.query(`ALTER TABLE "ats"."candidates" ALTER COLUMN id DROP DEFAULT;`);
    await client.query(`ALTER TABLE "ats"."candidates" ALTER COLUMN id SET DATA TYPE UUID USING (LPAD(id::text, 32, '0')::uuid);`);
    await client.query(`ALTER TABLE "ats"."candidates" ALTER COLUMN id SET DEFAULT gen_random_uuid();`);

    await client.query(`ALTER TABLE "ats"."recruiter_submissions" ALTER COLUMN id DROP DEFAULT;`);
    await client.query(`ALTER TABLE "ats"."recruiter_submissions" ALTER COLUMN id SET DATA TYPE UUID USING (LPAD(id::text, 32, '0')::uuid);`);
    await client.query(`ALTER TABLE "ats"."recruiter_submissions" ALTER COLUMN id SET DEFAULT gen_random_uuid();`);

    // 3. Change Foreign Keys
    console.log('Migrating Foreign Keys...');
    await client.query(`ALTER TABLE "ats"."candidates" ALTER COLUMN resume_record_id SET DATA TYPE UUID USING (LPAD(resume_record_id::text, 32, '0')::uuid);`);
    await client.query(`ALTER TABLE "ats"."recruiter_submissions" ALTER COLUMN candidate_id SET DATA TYPE UUID USING (LPAD(candidate_id::text, 32, '0')::uuid);`);
    await client.query(`ALTER TABLE "ats"."bulk_upload_items" ALTER COLUMN candidate_id SET DATA TYPE UUID USING (LPAD(candidate_id::text, 32, '0')::uuid);`);
    await client.query(`ALTER TABLE "mass_mail"."recipients" ALTER COLUMN candidate_id SET DATA TYPE UUID USING (LPAD(candidate_id::text, 32, '0')::uuid);`);

    // 4. Re-add constraints (Prisma schema standards)
    console.log('Re-adding constraints...');
    await client.query(`ALTER TABLE "ats"."candidates" ADD CONSTRAINT "candidates_resume_record_id_fkey" FOREIGN KEY (resume_record_id) REFERENCES "ats"."resumes"(id) ON DELETE SET NULL ON UPDATE CASCADE;`);
    
    // Note: candidate in recruiter_submissions is CASCADE delete in prisma schema
    await client.query(`ALTER TABLE "ats"."recruiter_submissions" ADD CONSTRAINT "recruiter_submissions_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES "ats"."candidates"(id) ON DELETE CASCADE ON UPDATE CASCADE;`);
    
    await client.query(`ALTER TABLE "ats"."bulk_upload_items" ADD CONSTRAINT "bulk_upload_items_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES "ats"."candidates"(id) ON DELETE SET NULL ON UPDATE CASCADE;`);

    // Also drop sequences since they are no longer needed
    await client.query(`DROP SEQUENCE IF EXISTS "ats"."resumes_id_seq" CASCADE;`);
    await client.query(`DROP SEQUENCE IF EXISTS "ats"."candidates_id_seq" CASCADE;`);
    await client.query(`DROP SEQUENCE IF EXISTS "ats"."recruiter_submissions_id_seq" CASCADE;`);

    await client.query('COMMIT');
    console.log('Migration successful!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
