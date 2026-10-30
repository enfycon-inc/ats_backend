import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessUnitsController } from './business-units.controller';
import { BusinessUnitsService } from './business-units.service';
import { DeliveryDashboardController } from './delivery-dashboard.controller';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import { AccountManagerDashboardService } from './account-manager-dashboard.service';
import { AccountManagerDetailService } from './account-manager-detail.service';
import { RecruiterPerformanceService } from './recruiter-performance.service';

@Module({
  imports: [AuthModule],
  controllers: [DeliveryDashboardController, BusinessUnitsController],
  providers: [BusinessUnitsService, DeliveryDashboardService, AccountManagerDashboardService, AccountManagerDetailService, RecruiterPerformanceService],
  exports: [BusinessUnitsService],
})
export class BusinessUnitsModule {}
