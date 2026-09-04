import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogOptions {
  tenantId?: string;
  actorId: string;
  actorEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an audit log entry in the PostgreSQL `ats.audit_logs` table via Prisma.
   */
  async log(options: AuditLogOptions): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: options.tenantId || null,
          actorId: options.actorId,
          actorEmail: options.actorEmail || null,
          action: options.action,
          targetType: options.targetType || null,
          targetId: options.targetId || null,
          details: options.details ?? {},
          ipAddress: options.ipAddress || null,
        },
      });
      this.logger.log(`[AUDIT] Action logged: ${options.action} by actor=${options.actorEmail || options.actorId} (Tenant: ${options.tenantId || 'GLOBAL'})`);
    } catch (err: any) {
      this.logger.error(`[AUDIT ERROR] Failed to record audit log: ${err.message}`, err.stack);
    }
  }

  /**
   * Retrieves audit logs with pagination and filters for Super Admin inspection.
   */
  async listLogs(tenantId?: string, limit = 100, offset = 0) {
    return await this.prisma.auditLog.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}
