import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    let url = process.env.DATABASE_URL || '';
    if (url && !url.includes('search_path')) {
      const sep = url.includes('?') ? '&' : '?';
      if (!url.includes('schema=')) {
        url = `${url}${sep}schema=ats&options=-csearch_path%3Dats%2Cmass_mail%2Cpublic`;
      } else {
        url = `${url}${sep}options=-csearch_path%3Dats%2Cmass_mail%2Cpublic`;
      }
    }

    super({
      datasources: {
        db: {
          url,
        },
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    this.logger.log('Connecting to PostgreSQL via Prisma...');
    await this.$connect();
    await this.$executeRawUnsafe('SET search_path TO ats, mass_mail, public;').catch(() => {});
    this.logger.log('Prisma connected successfully (search_path: ats, mass_mail, public).');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Prisma...');
    await this.$disconnect();
  }
}
