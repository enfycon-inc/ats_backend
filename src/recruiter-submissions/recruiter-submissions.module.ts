import { Module } from '@nestjs/common';
import { RecruiterSubmissionsController } from './recruiter-submissions.controller';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [RecruiterSubmissionsController],
  providers: [RecruiterSubmissionsService],
  exports: [RecruiterSubmissionsService],
})
export class RecruiterSubmissionsModule {}
