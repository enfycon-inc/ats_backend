import { Module } from '@nestjs/common';
import { RecruiterSubmissionsController } from './recruiter-submissions.controller';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecruiterSubmissionsController],
  providers: [RecruiterSubmissionsService],
  exports: [RecruiterSubmissionsService],
})
export class RecruiterSubmissionsModule {}
