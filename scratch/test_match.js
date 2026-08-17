const { Client } = require('pg');

async function testMatch() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tenantId = 'fad0ccbf-db00-4560-bbfc-216eea7b107b';
  const primarySkills = ['AWS', 'EC2', 'S3', 'Lambda', 'API Gateway', 'RDS', 'DynamoDB', 'VPC', 'IAM', 'CloudWatch', 'Java', 'Python', 'RESTful APIs', 'Microservices', 'PostgreSQL'];

  const candRes = await client.query(
    `SELECT c.id, c.full_name, c.email, c.raw_current_location, c.raw_current_designation, c.total_experience_years, r.raw_text, r.parsed_json
     FROM candidates c
     JOIN resumes r ON c.resume_record_id = r.id
     WHERE c.tenant_id = $1`,
    [tenantId]
  );

  const matches = candRes.rows.map(row => {
    let candidateSkills = [];
    if (row.parsed_json) {
      const parsed = typeof row.parsed_json === 'string' ? JSON.parse(row.parsed_json) : row.parsed_json;
      candidateSkills = parsed?.skills || [];
    }
    const skillSet = new Set(candidateSkills.map(s => String(s).toLowerCase().trim()));
    const rawText = (row.raw_text || '').toLowerCase();

    const matchedPrimary = primarySkills.filter(s => skillSet.has(s.toLowerCase()) || rawText.includes(s.toLowerCase()));
    const score = Math.round((matchedPrimary.length / primarySkills.length) * 100);

    return {
      id: row.id,
      name: row.full_name,
      designation: row.raw_current_designation,
      score,
      matchedSkillsCount: matchedPrimary.length
    };
  }).sort((a, b) => b.score - a.score);

  console.log('=== TOP MATCHES FOR AWS DEVELOPER ===');
  console.table(matches.slice(0, 10));

  const rahul = matches.find(m => m.name === 'Rahul Sharma');
  console.log('=== RAHUL SHARMA RANKING ===', rahul);

  await client.end();
}

testMatch().catch(console.error);
