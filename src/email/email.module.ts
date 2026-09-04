import { Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { EmailAuthController } from './email-auth.controller';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { AuthModule } from '../auth/auth.module';

import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: 'mass_mail' }),
  ],
  controllers: [EmailController, EmailAuthController],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
