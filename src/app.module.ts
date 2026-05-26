import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { CandidatesModule } from './candidates/candidates.module';
import { SourcingModule } from './sourcing/sourcing.module';
import { JobsModule } from './jobs/jobs.module';
import { RecruiterSubmissionsModule } from './recruiter-submissions/recruiter-submissions.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CandidatesModule,
    SourcingModule,
    JobsModule,
    RecruiterSubmissionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

