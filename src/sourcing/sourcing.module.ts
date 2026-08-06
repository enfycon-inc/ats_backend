import { Module } from '@nestjs/common';
import { SourcingController } from './sourcing.controller';
import { SourcingService } from './sourcing.service';
import { CandidatesModule } from '../candidates/candidates.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CandidatesModule, AuthModule],
  controllers: [SourcingController],
  providers: [SourcingService],
  exports: [SourcingService],
})
export class SourcingModule {}
