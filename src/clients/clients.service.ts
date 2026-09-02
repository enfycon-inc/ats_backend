import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly db: DatabaseService) {}

  async createClient(dto: any, tenantId: string, createdBy: string) {
    this.logger.log(`Creating client for tenant ${tenantId}`);

    // Fetch tenant details first
    const tenantRes = await this.db.query('SELECT prefix_code, name, domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    const tenant = tenantRes.rows[0];

    let clientCode = dto.client_code;
    if (!clientCode) {
      let prefix = tenant?.prefix_code;
      if (!prefix) {
        const rawName = tenant?.name || '';
        const cleanName = rawName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (cleanName.length >= 2) {
          prefix = cleanName.substring(0, 4);
        } else {
          const rawDomain = tenant?.domain || '';
          const cleanDomain = rawDomain.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          prefix = cleanDomain.substring(0, 4) || 'CL';
        }
      }

      // Atomic counter increment
      const counterRes = await this.db.query(`
        INSERT INTO tenant_counters (tenant_id, entity_type, current_value)
        VALUES ($1, 'client', 1)
        ON CONFLICT (tenant_id, entity_type) 
        DO UPDATE SET current_value = tenant_counters.current_value + 1
        RETURNING current_value
      `, [tenantId]);
      
      const seqNumber = counterRes.rows[0].current_value;
      const paddedSeq = String(seqNumber).padStart(5, '0');
      
      clientCode = `${prefix}-CL-${paddedSeq}`;
    }

    const endClientName = dto.is_same_as_primary !== false
      ? (dto.end_client_name || dto.client_name)
      : (dto.end_client_name || dto.client_name);

    // Resolve creator permissions and reviewer for client approval gate
    let initialStatus = 'Active';
    let approvalStatus = 'APPROVED';
    let assignedApproverId: string | null = null;
    let approvedBy: string | null = 'System';
    let approvedAt: Date | null = new Date();

    if (createdBy && createdBy !== 'System') {
      const creatorRes = await this.db.query(
        `SELECT u.id, u.job_reviewer_id, u.role_id, u.full_name, u.email,
                COALESCE(ARRAY_AGG(DISTINCT rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') as permissions
         FROM users u
         LEFT JOIN custom_roles cr ON (
           (u.role_id IS NOT NULL AND cr.id = u.role_id)
           OR (u.assigned_role_ids IS NOT NULL AND cr.id = ANY(COALESCE(u.assigned_role_ids, '{}')))
         )
         LEFT JOIN role_permissions rp ON cr.id = rp.role_id
         WHERE (u.email = $1 OR u.id::text = $1) AND u.tenant_id = $2
         GROUP BY u.id, u.job_reviewer_id, u.role_id, u.full_name, u.email
         LIMIT 1`,
        [createdBy, tenantId]
      ).catch(() => ({ rows: [] }));

      if (creatorRes.rows.length > 0) {
        const cRow = creatorRes.rows[0];
        const perms: string[] = Array.isArray(cRow.permissions) ? cRow.permissions : [];
        
        // Direct Add clearance: Strictly honors granular permissions ('client:direct_add', 'client:approve', 'tenant:settings', 'tenant:manage')
        // Unchecking 'client:direct_add' in the permissions matrix will enforce 'Pending Approval'.
        const hasDirectAddPerm = 
          perms.includes('client:direct_add') || 
          perms.includes('client:approve') || 
          perms.includes('tenant:settings') || 
          perms.includes('tenant:manage');

        if (!hasDirectAddPerm) {
          initialStatus = 'Pending Approval';
          approvalStatus = 'PENDING_APPROVAL';
          assignedApproverId = cRow.job_reviewer_id || null;
          approvedBy = null;
          approvedAt = null;
        } else {
          initialStatus = 'Active';
          approvalStatus = 'APPROVED';
          approvedBy = cRow.full_name || cRow.email || 'System';
          approvedAt = new Date();
        }
      }
    }

    const res = await this.db.query(
      `INSERT INTO clients (
        tenant_id, client_code, client_name, contact_number, website, industry,
        state, city, status, category, primary_owner, business_unit, ownership,
        display_on_job_posting, created_by, federal_id, email_id, fax,
        payment_terms, address, client_lead, postal_code, country, practice,
        required_documents, tag, client_short_name, geopolitical_zone,
        primary_business_unit, facility_management, modified_by, about_company, stop_notifications,
        market, end_client_name, is_same_as_primary, contact_person, contact_designation,
        gstin, pan_number, currency, tier_rating, credit_check_status, fillability_score,
        vetting_notes, onboarding_status, msa_signed, sow_executed, coi_received, vendor_portal_created,
        approval_status, assigned_approver_id, approved_by, approved_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44,
        $45, $46, $47, $48, $49, $50,
        $51, $52, $53, $54
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
        dto.status || initialStatus,
        dto.category,
        createdBy,
        dto.business_unit || tenant?.name || 'Default',
        dto.ownership,
        dto.display_on_job_posting !== undefined ? dto.display_on_job_posting : true,
        createdBy,
        dto.federal_id,
        dto.email_id,
        dto.fax,
        dto.payment_terms || 'Net 30',
        dto.address,
        dto.client_lead || dto.contact_person,
        dto.postal_code,
        dto.country,
        dto.practice,
        dto.required_documents,
        dto.tag,
        dto.client_short_name,
        dto.geopolitical_zone,
        dto.primary_business_unit,
        dto.facility_management,
        createdBy,
        dto.about_company,
        dto.stop_notifications || false,
        dto.market || 'US',
        endClientName,
        dto.is_same_as_primary !== undefined ? dto.is_same_as_primary : true,
        dto.contact_person || dto.contact_name,
        dto.contact_designation,
        dto.gstin,
        dto.pan_number,
        dto.currency || (dto.market === 'INDIA' ? 'INR' : 'USD'),
        dto.tier_rating || 'TIER_1',
        dto.credit_check_status || 'APPROVED',
        dto.fillability_score || 'HIGH',
        dto.vetting_notes,
        dto.onboarding_status || 'ACTIVE',
        dto.msa_signed || false,
        dto.sow_executed || false,
        dto.coi_received || false,
        dto.vendor_portal_created || false,
        approvalStatus,
        assignedApproverId,
        approvedBy,
        approvedAt,
      ]
    );
    return res.rows[0];
  }

  async findAllClients(tenantId: string, user?: any, includeDeleted = false) {
    let sql = `
      SELECT 
        c.*, 
        po.full_name AS primary_owner_name,
        (
          SELECT COUNT(*) 
          FROM jobs j 
          WHERE j.tenant_id::text = c.tenant_id::text 
            AND (
              j.client_id::text = c.id::text 
              OR j.end_client_id::text = c.id::text 
              OR LOWER(j.client_name) = LOWER(c.client_name) 
              OR LOWER(j.end_client_name) = LOWER(c.client_name)
            )
        ) AS active_jobs_count
      FROM clients c
      LEFT JOIN users po ON po.id::text = c.primary_owner
      WHERE c.tenant_id::text = $1
    `;

    const params: any[] = [tenantId];

    if (!includeDeleted) {
      sql += ` AND c.deleted_at IS NULL`;
    }

    sql += ' ORDER BY c.created_at DESC';

    const res = await this.db.query(sql, params);
    return res.rows.map(row => ({
      ...row,
      primary_owner: row.primary_owner_name || row.primary_owner || 'N/A'
    }));
  }

  async approveClient(id: string, tenantId: string, approvedBy: string) {
    const res = await this.db.query(
      `UPDATE clients 
       SET status = 'Active', approval_status = 'APPROVED', approved_by = $1, approved_at = NOW(), rejection_reason = NULL, updated_at = NOW()
       WHERE id::text = $2 AND tenant_id::text = $3 AND deleted_at IS NULL
       RETURNING *`,
      [approvedBy, id, tenantId]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return res.rows[0];
  }

  async rejectClient(id: string, tenantId: string, rejectedBy: string, reason?: string) {
    const res = await this.db.query(
      `UPDATE clients 
       SET status = 'Rejected', approval_status = 'REJECTED', approved_by = $1, approved_at = NOW(), rejection_reason = $2, updated_at = NOW()
       WHERE id::text = $3 AND tenant_id::text = $4 AND deleted_at IS NULL
       RETURNING *`,
      [rejectedBy, reason || 'Rejected by Reviewer', id, tenantId]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return res.rows[0];
  }

  async findOneClient(id: string, tenantId: string) {
    const res = await this.db.query(
      `SELECT c.*, po.full_name AS primary_owner_name, b.name AS branch_name
       FROM clients c
       LEFT JOIN users po ON po.id::text = c.primary_owner
       LEFT JOIN branches b ON b.id::text = c.branch_id::text
       WHERE c.id::text = $1 AND c.tenant_id::text = $2 AND c.deleted_at IS NULL`,
      [id, tenantId]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    const row = res.rows[0];

    // Fetch associated jobs
    const jobsRes = await this.db.query(
      `SELECT j.id, j.job_code, j.job_title, j.job_location, j.job_type, j.status, j.client_name, j.end_client_name, j.created_at
       FROM jobs j
       WHERE j.tenant_id::text = $1 
         AND (j.client_id::text = $2 OR j.end_client_id::text = $2 OR LOWER(j.client_name) = LOWER($3) OR LOWER(j.end_client_name) = LOWER($3))
       ORDER BY j.created_at DESC`,
      [tenantId, id, row.client_name]
    );

    return {
      ...row,
      primary_owner: row.primary_owner_name || row.primary_owner || 'N/A',
      associated_jobs: jobsRes.rows || [],
      active_jobs_count: jobsRes.rows.length
    };
  }


  async updateClient(id: string, dto: any, tenantId: string, modifiedBy: string, user?: any) {
    this.logger.log(`Updating client ${id} for tenant ${tenantId}`);

    // Check ownership & permissions for client editing
    if (user) {
      const userPermissions: string[] = Array.isArray(user.permissions) ? user.permissions : [];
      const canEditAll = 
        userPermissions.includes('client:edit_all') || 
        userPermissions.includes('client:approve') || 
        userPermissions.includes('tenant:settings') || 
        userPermissions.includes('tenant:manage');

      const canEditOwn = userPermissions.includes('client:edit');

      if (!canEditAll && canEditOwn) {
        // Verify user is primary owner or creator of this client
        const ownerCheck = await this.db.query(
          `SELECT primary_owner, created_by FROM clients WHERE id::text = $1 AND tenant_id::text = $2`,
          [id, tenantId]
        );
        if (ownerCheck.rows.length > 0) {
          const client = ownerCheck.rows[0];
          const userId = user.dbId || user.sub || user.id;
          const userEmail = user.email;
          const isOwner = client.primary_owner === userId || client.primary_owner === userEmail || client.created_by === userId || client.created_by === userEmail;
          if (!isOwner) {
            throw new ForbiddenException('You can only edit your own assigned client accounts.');
          }
        }
      } else if (!canEditAll && !canEditOwn) {
        throw new ForbiddenException('You do not have permission (client:edit) to modify client accounts.');
      }
    }

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
      'primary_business_unit', 'facility_management',
      'market', 'end_client_name', 'is_same_as_primary', 'contact_person', 'contact_designation',
      'gstin', 'pan_number', 'currency', 'tier_rating', 'credit_check_status', 'fillability_score',
      'vetting_notes', 'onboarding_status', 'msa_signed', 'sow_executed', 'coi_received', 'vendor_portal_created'
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
      WHERE id::text = $${idIndex} AND tenant_id::text = $${tenantIndex} AND deleted_at IS NULL
      RETURNING *
    `;

    const res = await this.db.query(query, values);
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return res.rows[0];
  }

  async deleteClient(id: string, tenantId: string, modifiedBy?: string) {
    this.logger.log(`Soft deleting client ${id} for tenant ${tenantId}`);
    const res = await this.db.query(
      `UPDATE clients SET deleted_at = NOW(), modified_by = $3 WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL RETURNING id`,
      [id, tenantId, modifiedBy || 'System']
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found or already deleted`);
    }
    return true;
  }

  async restoreClient(id: string, tenantId: string, modifiedBy?: string) {
    this.logger.log(`Restoring client ${id} for tenant ${tenantId}`);
    const res = await this.db.query(
      `UPDATE clients SET deleted_at = NULL, modified_by = $3 WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NOT NULL RETURNING *`,
      [id, tenantId, modifiedBy || 'System']
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Client with ID ${id} not found or not deleted`);
    }
    return res.rows[0];
  }

  async isClientApproved(clientNameOrId: string, tenantId: string): Promise<{ approved: boolean; status: string; clientName: string }> {
    if (!clientNameOrId || !clientNameOrId.trim()) {
      return { approved: true, status: 'Active', clientName: '' };
    }
    const lookup = clientNameOrId.trim();
    const res = await this.db.query(
      `SELECT id, client_name, status, approval_status FROM clients
       WHERE (id::text = $1 OR LOWER(client_name) = LOWER($1) OR LOWER(client_code) = LOWER($1))
         AND tenant_id::text = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [lookup, tenantId]
    );

    if (res.rows.length === 0) {
      return { approved: false, status: 'Not Found', clientName: lookup };
    }

    const row = res.rows[0];
    const isApproved =
      (row.approval_status === 'APPROVED' || !row.approval_status) &&
      row.status !== 'Pending Approval' &&
      row.status !== 'Rejected';

    return {
      approved: isApproved,
      status: row.status || (row.approval_status === 'PENDING_APPROVAL' ? 'Pending Approval' : 'Active'),
      clientName: row.client_name,
    };
  }
}

