import { Module } from '@nestjs/common';
import { MarketSegmentsService } from './market-segments.service';
import { MarketSegmentsController } from './market-segments.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarketSegmentsController],
  providers: [MarketSegmentsService],
  exports: [MarketSegmentsService],
})
export class MarketSegmentsModule {}
