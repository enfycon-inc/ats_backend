import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';
import { BulkCvProcessor } from './bulk-cv.processor';
import { AuthModule } from '../auth/auth.module';
import { ResumePreviewService } from './resume-preview.service';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: 'bulk_cv' }),
  ],
  controllers: [CandidatesController],
  providers: [CandidatesService, BulkCvProcessor, ResumePreviewService],
  exports: [CandidatesService],
})
export class CandidatesModule {}
