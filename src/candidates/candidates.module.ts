import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';
import { BulkCvProcessor } from './bulk-cv.processor';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: 'bulk_cv' }),
  ],
  controllers: [CandidatesController],
  providers: [CandidatesService, BulkCvProcessor],
  exports: [CandidatesService],
})
export class CandidatesModule {}
