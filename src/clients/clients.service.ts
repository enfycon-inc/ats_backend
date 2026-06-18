import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly db: DatabaseService) {}

  async createClient(dto: any, tenantId: string, createdBy: string) {
    this.logger.log(`Creating client for tenant ${tenantId}`);

    let clientCode = dto.client_code;
    if (!clientCode) {
      // Fetch tenant prefix
      const tenantRes = await this.db.query('SELECT prefix_code FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
      const prefix = tenantRes.rows[0]?.prefix_code || 'CL';

      // Atomic counter increment
      const counterRes = await this.db.query(`
        INSERT INTO tenant_counters (tenant_id, entity_type, current_value)
        VALUES ($1, 'client', 1)
        ON CONFLICT (tenant_id, entity_type) 
        DO UPDATE SET current_value = tenant_counters.current_value + 1
        RETURNING current_value
      `, [tenantId]);
      
      const seqNumber = counterRes.rows[0].current_value;
      const paddedSeq = String(seqNumber).padStart(3, '0');
      
      clientCode = `${prefix}-CL-${paddedSeq}`;
    }

    const res = await this.db.query(
      `INSERT INTO clients (
        tenant_id, client_code, client_name, contact_number, website, industry,
        state, city, status, category, primary_owner, business_unit, ownership,
        display_on_job_posting, created_by, federal_id, email_id, fax,
        payment_terms, address, client_lead, postal_code, country, practice,
        required_documents, tag, client_short_name, geopolitical_zone,
        primary_business_unit, facility_management, modified_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31
      ) RETURNING *`,
      [
        tenantId,
        clientCode,
        dto.client_name,
        dto.contact_number,
        dto.website,
        dto.industry,
        dto.state,
        dto.city,
        dto.status || 'Active',
        dto.category,
        dto.primary_owner,
        dto.business_unit,
        dto.ownership,
        dto.display_on_job_posting !== undefined ? dto.display_on_job_posting : true,
        createdBy,
        dto.federal_id,
        dto.email_id,
        dto.fax,
        dto.payment_terms,
        dto.address,
        dto.client_lead,
        dto.postal_code,
        dto.country,
        dto.practice,
        dto.required_documents,
        dto.tag,
        dto.client_short_name,
        dto.geopolitical_zone,
        dto.primary_business_unit,
        dto.facility_management,
        createdBy
      ]
    );
    return res.rows[0];
  }

  async findAllClients(tenantId: string) {
    const res = await this.db.query(
      `SELECT * FROM clients WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    return res.rows;
  }

  async findOneClient(id: string, tenantId: string) {
    const res = await this.db.query(
      `SELECT * FROM clients WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return res.rows[0];
  }

  async updateClient(id: string, dto: any, tenantId: string, modifiedBy: string) {
    this.logger.log(`Updating client ${id} for tenant ${tenantId}`);

    // Extract allowed fields and construct dynamic query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // List of allowed column names to update
    const allowedColumns = [
      'client_code', 'client_name', 'contact_number', 'website', 'industry',
      'state', 'city', 'status', 'category', 'primary_owner', 'business_unit', 'ownership',
      'display_on_job_posting', 'federal_id', 'email_id', 'fax',
      'payment_terms', 'address', 'client_lead', 'postal_code', 'country', 'practice',
      'required_documents', 'tag', 'client_short_name', 'geopolitical_zone',
      'primary_business_unit', 'facility_management'
    ];

    for (const key of allowedColumns) {
      if (dto[key] !== undefined) {
        updates.push(`"${key}" = $${paramIndex}`);
        values.push(dto[key]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return this.findOneClient(id, tenantId); // Nothing to update
    }

    updates.push(`modified_by = $${paramIndex}`);
    values.push(modifiedBy);
    paramIndex++;

    updates.push(`updated_at = NOW()`);

    values.push(id);
    const idIndex = paramIndex;
    paramIndex++;

    values.push(tenantId);
    const tenantIndex = paramIndex;

    const query = `
      UPDATE clients
      SET ${updates.join(', ')}
      WHERE id = $${idIndex} AND tenant_id = $${tenantIndex}
      RETURNING *
    `;

    const res = await this.db.query(query, values);
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return res.rows[0];
  }

  async deleteClient(id: string, tenantId: string) {
    this.logger.log(`Deleting client ${id} for tenant ${tenantId}`);
    const res = await this.db.query(
      `DELETE FROM clients WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return true;
  }
}
