import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SessionTrackingService } from './session-tracking.service';
import { UserManagementService } from './user-management.service';
import { UserManagementController } from './user-management.controller';
import { SecurityWorkerService } from './security-worker.service';
import { OfficeLocationService } from './office-location.service';
import { OfficeConsentService } from './office-consent.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'user-management' })],
  providers: [SessionTrackingService, UserManagementService, SecurityWorkerService, OfficeLocationService, OfficeConsentService],
  controllers: [UserManagementController],
  exports: [SessionTrackingService, UserManagementService],
})
export class UserManagementModule {}
