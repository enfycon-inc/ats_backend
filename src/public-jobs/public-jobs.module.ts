import { Module } from '@nestjs/common';
import { CareerOauthClientController, CareerOauthTokenController, JobPublicationController, PublicJobsController, PublicJobsKeyController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { PublicJobsKeyGuard } from './public-jobs-key.guard';
import { CareerOauthService } from './career-oauth.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CareerOauthClientController, CareerOauthTokenController, PublicJobsController, PublicJobsKeyController, JobPublicationController],
  providers: [CareerOauthService, PublicJobsService, PublicJobsKeyGuard],
})
export class PublicJobsModule {}
