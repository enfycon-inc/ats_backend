const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { JobsService } = require('./dist/jobs/jobs.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobsService = app.get(JobsService);
  
  const jobs = await jobsService.findAllJobs('737f666b-916a-4e9c-91bd-b2bd37e475d1', { permissions: ['tenant:manage'], roles: ['TENANTADMIN'] });
  const job = jobs.find(j => j.jobCode === 'VIZ-IND-261001-001');
  console.log('API Job Profile:', job);
  
  await app.close();
}
main().catch(console.error);
