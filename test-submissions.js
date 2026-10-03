const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  try {
    const tenantId = '00000000-0000-0000-0000-000000000000';
    const sql = `
      SELECT 
        s.*,
        j.job_code,
        cb.full_name AS cb_name
      FROM ats.recruiter_submissions s
      LEFT JOIN ats.jobs j ON s.job_id = j.id
      LEFT JOIN ats.users cb ON (j.created_by = cb.id)
      WHERE s.tenant_id = $1 LIMIT 1
    `;
    const res = await prisma.$queryRawUnsafe(sql, tenantId);
    console.log('Result:', res.length > 0 ? 'Found' : 'Not found');
  } catch(e) {
    console.error('Database Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
test();
