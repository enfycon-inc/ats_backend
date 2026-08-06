import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { BusinessUnitsController } from './business-units.controller';
import { BusinessUnitsService } from './business-units.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [BusinessUnitsController],
  providers: [BusinessUnitsService],
  exports: [BusinessUnitsService],
})
export class BusinessUnitsModule {}
