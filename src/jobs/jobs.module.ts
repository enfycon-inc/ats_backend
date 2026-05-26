import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}

