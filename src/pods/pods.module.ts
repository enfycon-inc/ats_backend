import { Module } from '@nestjs/common';
import { PodsService } from './pods.service';
import { PodsController } from './pods.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PodsController],
  providers: [PodsService],
  exports: [PodsService],
})
export class PodsModule {}
