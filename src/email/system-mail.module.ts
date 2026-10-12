import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemMailService } from './system-mail.service';

@Module({
  imports: [PrismaModule],
  providers: [SystemMailService],
  exports: [SystemMailService],
})
export class SystemMailModule {}
