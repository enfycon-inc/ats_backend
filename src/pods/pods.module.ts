import { Module } from '@nestjs/common';
import { PodsService } from './pods.service';
import { PodsController } from './pods.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PodsController],
  providers: [PodsService],
  exports: [PodsService],
})
export class PodsModule {}
