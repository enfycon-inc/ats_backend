import { Module } from '@nestjs/common';
import { CandidatesModule } from '../../candidates/candidates.module';
import { DiceController } from './dice.controller';
import { DiceService } from './dice.service';

@Module({
  imports: [CandidatesModule],
  controllers: [DiceController],
  providers: [DiceService],
  exports: [DiceService],
})
export class DiceModule {}
