import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CandidatesModule } from '../../candidates/candidates.module';
import { DiceController } from './dice.controller';
import { DiceService } from './dice.service';

@Module({
  imports: [DatabaseModule, CandidatesModule],
  controllers: [DiceController],
  providers: [DiceService],
  exports: [DiceService],
})
export class DiceModule {}
