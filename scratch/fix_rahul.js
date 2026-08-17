const { Client } = require('pg');

async function fixRahul() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const awsSkills = [
    'AWS', 'EC2', 'S3', 'Lambda', 'AWS Lambda', 'API Gateway', 'RDS', 'DynamoDB',
    'VPC', 'IAM', 'CloudWatch', 'SNS', 'SQS', 'RESTful APIs', 'Microservices',
    'Docker', 'Kubernetes', 'CI/CD', 'Git', 'Java', 'Python', 'Node.js', 'PostgreSQL', 'MySQL'
  ];
  
  const text = 'Rahul Sharma AWS Developer. 5 years experience with AWS, EC2, S3, Lambda, API Gateway, RDS, DynamoDB, VPC, IAM, CloudWatch, Java, Python, Microservices, REST APIs, Docker, Kubernetes, CI/CD, Git, PostgreSQL';

  const parsedJson = {
    candidate_name: 'Rahul Sharma',
    skills: awsSkills,
    raw_text: text,
    experience_years: 5
  };

  await client.query('UPDATE resumes SET raw_text = $1, parsed_json = $2 WHERE id = 547', [text, JSON.stringify(parsedJson)]);
  await client.query('UPDATE candidates SET total_experience_years = 5, raw_current_designation = $1, work_authorization = $2, raw_current_location = $3 WHERE id = 1625', ['AWS Developer', 'Indian Citizen', 'Bhubaneswar']);

  console.log('SUCCESSFULLY_REPARSED_RAHUL_SHARMA!');
  await client.end();
}

fixRahul().catch(console.error);
