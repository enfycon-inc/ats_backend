import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shared SQL query helper used by all Auth sub-services.
 * Provides a backward-compatible PostgreSQL-style { rows, rowCount } interface
 * on top of Prisma's $queryRawUnsafe / $executeRawUnsafe.
 */
@Injectable()
export class AuthQueryService {
  protected readonly logger = new Logger(AuthQueryService.name);

  constructor(readonly prisma: PrismaService) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    const trimmed = sql.trim();
    const cleanSql = trimmed.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
    const isMutationWithoutReturning =
      /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|DO)\b/i.test(cleanSql) &&
      !/RETURNING/i.test(cleanSql);

    try {
      if (isMutationWithoutReturning) {
        const count = await this.prisma.$executeRawUnsafe(sql, ...(params || []));
        return { rows: [], rowCount: count };
      } else {
        const rawRows = await this.prisma.$queryRawUnsafe<T[]>(sql, ...(params || []));
        const rows = this.convertBigInts(Array.isArray(rawRows) ? rawRows : []);
        return { rows, rowCount: rows.length };
      }
    } catch (err: any) {
      this.logger.error(`Query error: ${err.message} | SQL: ${sql.slice(0, 150)}...`);
      throw err;
    }
  }

  convertBigInts(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (Array.isArray(obj)) return obj.map((item) => this.convertBigInts(item));
    if (typeof obj === 'object') {
      const converted: Record<string, any> = {};
      for (const [key, val] of Object.entries(obj)) {
        converted[key] = typeof val === 'bigint' ? Number(val) : val;
      }
      return converted;
    }
    return obj;
  }
}
