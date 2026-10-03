import { Module } from '@nestjs/common';
import { ClientContactsController } from './client-contacts.controller';
import { ClientContactsService } from './client-contacts.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClientContactsController],
  providers: [ClientContactsService],
  exports: [ClientContactsService],
})
export class ClientContactsModule {}
