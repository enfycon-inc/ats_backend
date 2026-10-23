import { Module } from '@nestjs/common';
import { JobPublicationController, PublicJobsController, PublicJobsKeyController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { PublicJobsKeyGuard } from './public-jobs-key.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PublicJobsController, PublicJobsKeyController, JobPublicationController],
  providers: [PublicJobsService, PublicJobsKeyGuard],
})
export class PublicJobsModule {}
