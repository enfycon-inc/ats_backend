import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
