const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { JobsService } = require('./dist/jobs/jobs.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobsService = app.get(JobsService);
  
  try {
    const res = await jobsService.updateJob(
      '639aaf25-6a6d-4107-9c54-582456d03296', 
      {
        recruiterIds: ['990dfd65-a084-47bd-89db-0845dff5c14f', 'f8bdcd3f-c327-46ea-a277-678e812d5c74'], // Ananya Reddy and Account Manager
        recruiter: 'Ananya Reddy, Account Manager',
        assignedTo: 'Ananya Reddy, Account Manager'
      }, 
      '737f666b-916a-4e9c-91bd-b2bd37e475d1', 
      '9911b98a-487f-4e0a-8266-62dd407e3c8e' // Admin user
    );
    console.log('Update Result:', res.recruiter, res.recruiterIds);
  } catch (err) {
    console.error('Update Failed:', err);
  }
  
  await app.close();
}
main().catch(console.error);
