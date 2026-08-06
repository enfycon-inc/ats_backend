import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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

  constructor(private readonly db: DatabaseService) {}

  /**
   * Records an audit log entry in the PostgreSQL `audit_logs` table.
   */
  async log(options: AuditLogOptions): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, target_type, target_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          options.tenantId || null,
          options.actorId,
          options.actorEmail || null,
          options.action,
          options.targetType || null,
          options.targetId || null,
          options.details ? JSON.stringify(options.details) : '{}',
          options.ipAddress || null,
        ]
      );
      this.logger.log(`[AUDIT] Action logged: ${options.action} by actor=${options.actorEmail || options.actorId} (Tenant: ${options.tenantId || 'GLOBAL'})`);
    } catch (err) {
      this.logger.error(`[AUDIT ERROR] Failed to record audit log: ${err.message}`, err.stack);
    }
  }

  /**
   * Retrieves audit logs with pagination and filters for Super Admin inspection.
   */
  async listLogs(tenantId?: string, limit = 100, offset = 0) {
    let sql = `SELECT * FROM audit_logs`;
    const params: any[] = [];
    if (tenantId) {
      sql += ` WHERE tenant_id = $1`;
      params.push(tenantId);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const res = await this.db.query(sql, params);
    return res.rows;
  }
}
