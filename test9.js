const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { JobsService } = require('./dist/jobs/jobs.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobsService = app.get(JobsService);
  
  try {
    const jobs = await jobsService.findAllJobs(
      '737f666b-916a-4e9c-91bd-b2bd37e475d1',
      { dbId: '9911b98a-487f-4e0a-8266-62dd407e3c8e', permissions: ['tenant:manage'] }
    );
    const job = jobs.find(j => j.jobCode === 'VIZ-IND-261001-001');
    console.log('API Job Profile recruiter:', job.recruiter);
    console.log('API Job Profile recruiterIds:', job.recruiterIds);
  } catch (err) {
    console.error(err);
  }
  
  await app.close();
}
main().catch(console.error);
