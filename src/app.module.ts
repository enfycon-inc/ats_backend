import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CandidatesModule } from './candidates/candidates.module';
import { SourcingModule } from './sourcing/sourcing.module';
import { JobsModule } from './jobs/jobs.module';
import { RecruiterSubmissionsModule } from './recruiter-submissions/recruiter-submissions.module';
import { EmailModule } from './email/email.module';
import { BullModule } from '@nestjs/bullmq';
import { ClientsModule } from './clients/clients.module';
import { PodsModule } from './pods/pods.module';
import { BranchesModule } from './branches/branches.module';
import { BusinessUnitsModule } from './business-units/business-units.module';
import { AuditModule } from './audit/audit.module';
import { EventsModule } from './events/events.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DiceModule } from './integrations/dice/dice.module';
import { PrismaModule } from './prisma/prisma.module';
import { MarketSegmentsModule } from './market-segments/market-segments.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    EventsModule,
    NotificationsModule,
    CandidatesModule,
    SourcingModule,
    JobsModule,
    RecruiterSubmissionsModule,
    EmailModule,
    ClientsModule,
    PodsModule,
    BranchesModule,
    BusinessUnitsModule,
    MarketSegmentsModule,
    DiceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}


