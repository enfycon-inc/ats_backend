import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private validateActorId(actorId: string): string {
    if (typeof actorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) {
      throw new BadRequestException('A valid authenticated user ID is required. Please sign in again.');
    }
    return actorId;
  }

  private formatClient(
    client: any,
    extra?: {
      primaryOwnerName?: string;
      branchName?: string;
      activeJobsCount?: number;
      associatedJobs?: any[];
    },
  ) {
    if (!client) return null;

    return {
      ...client,
      primaryOwner: extra?.primaryOwnerName || client.primaryOwner || 'N/A',
      tenant_id: client.tenantId,
      client_code: client.clientCode,
      client_name: client.clientName,
      contact_number: client.contactNumber,
      website: client.website,
      industry: client.industry,
      state: client.state,
      city: client.city,
      status: client.status,
      category: client.category,
      primary_owner: extra?.primaryOwnerName || client.primaryOwner || 'N/A',
      business_unit: client.businessUnit,
      ownership: client.ownership,
      display_on_job_posting: client.displayOnJobPosting,
      created_by: client.createdBy,
      federal_id: client.federalId,
      email_id: client.emailId,
      fax: client.fax,
      payment_terms: client.paymentTerms,
      address: client.address,
      client_lead: client.clientLead,
      postal_code: client.postalCode,
      country: client.country,
      practice: client.practice,
      required_documents: client.requiredDocuments,
      tag: client.tag,
      client_short_name: client.clientShortName,
      geopolitical_zone: client.geopoliticalZone,
      primary_business_unit: client.primaryBusinessUnit,
      facility_management: client.facilityManagement,
      modified_by: client.modifiedBy,
      about_company: client.aboutCompany,
      stop_notifications: client.stopNotifications,
      market: client.market,
      end_client_name: client.endClientName,
      is_same_as_primary: client.isSameAsPrimary,
      contact_person: client.contactPerson,
      contact_designation: client.contactDesignation,
      gstin: client.gstin,
      pan_number: client.panNumber,
      currency: client.currency,
      tier_rating: client.tierRating,
      credit_check_status: client.creditCheckStatus,
      fillability_score: client.fillabilityScore,
      vetting_notes: client.vettingNotes,
      onboarding_status: client.onboardingStatus,
      msa_signed: client.msaSigned,
      sow_executed: client.sowExecuted,
      coi_received: client.coiReceived,
      vendor_portal_created: client.vendorPortalCreated,
      approval_status: client.approvalStatus,
      assigned_approver_id: client.assignedApproverId,
      approved_by: client.approvedBy,
      approved_at: client.approvedAt,
      rejection_reason: client.rejectionReason,
      created_at: client.createdAt,
      updated_at: client.updatedAt,
      deleted_at: client.deletedAt,
      ...(extra?.activeJobsCount !== undefined ? { active_jobs_count: extra.activeJobsCount } : {}),
      ...(extra?.associatedJobs !== undefined ? { associated_jobs: extra.associatedJobs } : {}),
      ...(extra?.branchName !== undefined ? { branch_name: extra.branchName } : {}),
    };
  }

  async createClient(dto: any, tenantId: string, createdBy: string) {
    this.logger.log(`Creating client for tenant ${tenantId}`);
    this.validateActorId(createdBy);
    const creator = await this.prisma.user.findFirst({
      where: { id: createdBy, tenantId },
      select: { id: true, jobReviewerId: true, roleId: true, assignedRoleIds: true },
    });
    if (!creator) throw new ForbiddenException('The authenticated user does not belong to this workspace.');

    // Fetch tenant details first
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { prefixCode: true, name: true, domain: true },
    });

    let clientCode = dto.client_code;
    if (!clientCode) {
      let prefix = tenant?.prefixCode;
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
      const counter = await this.prisma.tenantCounters.upsert({
        where: {
          tenantId_entityType: {
            tenantId,
            entityType: 'client',
          },
        },
        update: {
          currentValue: { increment: 1 },
        },
        create: {
          tenantId,
          entityType: 'client',
          currentValue: 1,
        },
      });

      const seqNumber = counter.currentValue;
      const paddedSeq = String(seqNumber).padStart(5, '0');
      clientCode = `${prefix}-CL-${paddedSeq}`;
    }

    const endClientName =
      dto.is_same_as_primary !== false
        ? dto.end_client_name || dto.client_name
        : dto.end_client_name || dto.client_name;

    // Resolve creator permissions and reviewer for client approval gate
    let initialStatus = 'Active';
    let approvalStatus = 'APPROVED';
    let assignedApproverId: string | null = null;
    let approvedBy: string | null = creator.id;
    let approvedAt: Date | null = new Date();

    let roleIds: string[] = [];
    if (creator.roleId) roleIds.push(creator.roleId);
    if (creator.assignedRoleIds && creator.assignedRoleIds.length > 0) {
      roleIds.push(...creator.assignedRoleIds);
    }
    roleIds = [...new Set(roleIds)];

    let perms: string[] = [];
    if (roleIds.length > 0) {
      const customRoles = await this.prisma.customRole.findMany({
        where: { id: { in: roleIds } },
        select: { permissions: true },
      });
      const systemRoles = await this.prisma.systemRole.findMany({
        where: { id: { in: roleIds } },
        select: { permissions: true },
      });
      const allPerms = [...customRoles, ...systemRoles].flatMap((r) => {
        const p = r.permissions;
        if (Array.isArray(p)) return p as string[];
        if (typeof p === 'string') {
          try {
            const parsed = JSON.parse(p);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      });
      perms = [...new Set(allPerms)];
    }

    const hasDirectAddPerm =
      perms.includes('client:direct_add') ||
      perms.includes('client:approve') ||
      perms.includes('tenant:settings') ||
      perms.includes('tenant:manage');

    if (!hasDirectAddPerm) {
      initialStatus = 'Pending Approval';
      approvalStatus = 'PENDING_APPROVAL';
      assignedApproverId = creator.jobReviewerId || null;
      approvedBy = null;
      approvedAt = null;
    } else {
      initialStatus = 'Active';
      approvalStatus = 'APPROVED';
      approvedBy = creator.id;
      approvedAt = new Date();
    }

    const created = await this.prisma.client.create({
      data: {
        tenantId,
        clientCode,
        clientName: dto.client_name,
        contactNumber: dto.contact_number,
        website: dto.website,
        industry: dto.industry,
        state: dto.state,
        city: dto.city,
        status: dto.status || initialStatus,
        category: dto.category,
        primaryOwner: createdBy,
        businessUnit: dto.business_unit || tenant?.name || 'Default',
        branchId: dto.branch_id || null, ownership: dto.ownership,
        displayOnJobPosting: dto.display_on_job_posting !== undefined ? dto.display_on_job_posting : true,
        createdBy,
        federalId: dto.federal_id,
        emailId: dto.email_id,
        fax: dto.fax,
        paymentTerms: dto.payment_terms || 'Net 30',
        address: dto.address,
        clientLead: dto.client_lead || dto.contact_person,
        postalCode: dto.postal_code,
        country: dto.country,
        practice: dto.practice,
        requiredDocuments: dto.required_documents,
        tag: dto.tag,
        clientShortName: dto.client_short_name,
        geopoliticalZone: dto.geopolitical_zone,
        primaryBusinessUnit: dto.primary_business_unit,
        facilityManagement: dto.facility_management,
        modifiedBy: createdBy,
        aboutCompany: dto.about_company,
        stopNotifications: dto.stop_notifications || false,
        market: dto.market || 'US',
        endClientName,
        isSameAsPrimary: dto.is_same_as_primary !== undefined ? dto.is_same_as_primary : true,
        contactPerson: dto.contact_person || dto.contact_name,
        contactDesignation: dto.contact_designation,
        gstin: dto.gstin,
        panNumber: dto.pan_number,
        currency: dto.currency || (dto.market === 'INDIA' ? 'INR' : 'USD'),
        tierRating: dto.tier_rating || 'TIER_1',
        creditCheckStatus: dto.credit_check_status || 'APPROVED',
        fillabilityScore: dto.fillability_score || 'HIGH',
        vettingNotes: dto.vetting_notes,
        onboardingStatus: dto.onboarding_status || 'ACTIVE',
        msaSigned: dto.msa_signed || false,
        sowExecuted: dto.sow_executed || false,
        coiReceived: dto.coi_received || false,
        vendorPortalCreated: dto.vendor_portal_created || false,
        approvalStatus,
        assignedApproverId,
        approvedBy,
        approvedAt,
      },
    });

    return this.formatClient(created);
  }

  async findAllClients(tenantId: string, user?: any, includeDeleted = false) {
    const where: any = { tenantId };
    if (!includeDeleted) {
      where.deletedAt = null;
    }

    const [clients, jobs] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          clientId: true,
          endClientId: true,
          
          
        },
      }),
    ]);

    // Resolve primary owner names in bulk
    const ownerIds = [...new Set(clients.map((c) => c.primaryOwner).filter(Boolean) as string[])];
    const isUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const uuidOwners = ownerIds.filter(isUuid);
    const emailOwners = ownerIds.filter((o) => !isUuid(o));

    const owners = await this.prisma.user.findMany({
      where: {
        tenantId,
        OR: [
          ...(uuidOwners.length > 0 ? [{ id: { in: uuidOwners } }] : []),
          ...(emailOwners.length > 0 ? [{ email: { in: emailOwners } }] : []),
        ],
      },
      select: { id: true, email: true, fullName: true },
    });

    const ownerMap = new Map<string, string>();
    owners.forEach((u) => {
      ownerMap.set(u.id, u.fullName);
      ownerMap.set(u.email, u.fullName);
    });

    return clients.map((c) => {
      const primaryOwnerName = c.primaryOwner ? ownerMap.get(c.primaryOwner) : undefined;
      const cNameLower = c.clientName.toLowerCase();

      const activeJobsCount = jobs.filter((j) => {
        return (
          j.clientId === c.id ||
          j.endClientId === c.id ||
          (j.clientId === c.id) ||
          (j.endClientId === c.id)
        );
      }).length;

      return this.formatClient(c, {
        primaryOwnerName,
        activeJobsCount,
      });
    });
  }

  async findOneClient(id: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        branch: { select: { name: true } },
      },
    });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    let primaryOwnerName: string | undefined;
    if (client.primaryOwner) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client.primaryOwner);
      const owner = await this.prisma.user.findFirst({
        where: {
          tenantId,
          OR: isUuid ? [{ id: client.primaryOwner }, { email: client.primaryOwner }] : [{ email: client.primaryOwner }],
        },
        select: { fullName: true },
      });
      primaryOwnerName = owner?.fullName;
    }

    // Fetch associated jobs
    const jobs = await this.prisma.job.findMany({
      where: {
        tenantId,
        OR: [
          { clientId: id },
          { endClientId: id },
          { clientId: client.id },
          { endClientId: client.id },
        ],
      },
      select: {
        id: true,
        jobCode: true,
        jobTitle: true,
        jobType: true,
        status: true,
        
        
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedJobs = jobs.map((j) => ({
      ...j,
      job_code: j.jobCode,
      job_title: j.jobTitle,
      job_type: j.jobType,
      
      
      created_at: j.createdAt,
    }));

    return this.formatClient(client, {
      primaryOwnerName,
      branchName: client.branch?.name,
      activeJobsCount: formattedJobs.length,
      associatedJobs: formattedJobs,
    });
  }

  async approveClient(id: string, tenantId: string, approvedBy: string) {
    this.validateActorId(approvedBy);
    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        status: 'Active',
        approvalStatus: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });

    return this.formatClient(updated);
  }

  async rejectClient(id: string, tenantId: string, rejectedBy: string, reason?: string) {
    this.validateActorId(rejectedBy);
    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        status: 'Rejected',
        approvalStatus: 'REJECTED',
        approvedBy: rejectedBy,
        approvedAt: new Date(),
        rejectionReason: reason || 'Rejected by Reviewer',
      },
    });

    return this.formatClient(updated);
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
        const client = await this.prisma.client.findFirst({
          where: { id, tenantId },
          select: { primaryOwner: true, createdBy: true },
        });

        if (client) {
          const userId = user.dbId || user.sub || user.id;
          const userEmail = user.email;
          const isOwner =
            client.primaryOwner === userId ||
            client.primaryOwner === userEmail ||
            client.createdBy === userId ||
            client.createdBy === userEmail;
          if (!isOwner) {
            throw new ForbiddenException('You can only edit your own assigned client accounts.');
          }
        }
      } else if (!canEditAll && !canEditOwn) {
        throw new ForbiddenException('You do not have permission (client:edit) to modify client accounts.');
      }
    }

    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    const data: any = { modifiedBy };
    const fieldMap: Record<string, string> = {
      client_code: 'clientCode', clientCode: 'clientCode',
      client_name: 'clientName', clientName: 'clientName',
      contact_number: 'contactNumber', contactNumber: 'contactNumber',
      website: 'website',
      industry: 'industry',
      state: 'state',
      city: 'city',
      status: 'status',
      category: 'category',
      primary_owner: 'primaryOwner', primaryOwner: 'primaryOwner',
      business_unit: 'businessUnit', businessUnit: 'businessUnit', branch_id: 'branchId', branchId: 'branchId',
      ownership: 'ownership',
      display_on_job_posting: 'displayOnJobPosting', displayOnJobPosting: 'displayOnJobPosting',
      federal_id: 'federalId', federalId: 'federalId',
      email_id: 'emailId', emailId: 'emailId',
      fax: 'fax',
      payment_terms: 'paymentTerms', paymentTerms: 'paymentTerms',
      address: 'address',
      client_lead: 'clientLead', clientLead: 'clientLead',
      postal_code: 'postalCode', postalCode: 'postalCode',
      country: 'country',
      practice: 'practice',
      required_documents: 'requiredDocuments', requiredDocuments: 'requiredDocuments',
      tag: 'tag',
      client_short_name: 'clientShortName', clientShortName: 'clientShortName',
      geopolitical_zone: 'geopoliticalZone', geopoliticalZone: 'geopoliticalZone',
      primary_business_unit: 'primaryBusinessUnit', primaryBusinessUnit: 'primaryBusinessUnit',
      facility_management: 'facilityManagement', facilityManagement: 'facilityManagement',
      market: 'market',
      end_client_name: 'endClientName', endClientName: 'endClientName',
      is_same_as_primary: 'isSameAsPrimary', isSameAsPrimary: 'isSameAsPrimary',
      contact_person: 'contactPerson', contactPerson: 'contactPerson',
      contact_designation: 'contactDesignation', contactDesignation: 'contactDesignation',
      gstin: 'gstin',
      pan_number: 'panNumber', panNumber: 'panNumber',
      currency: 'currency',
      tier_rating: 'tierRating', tierRating: 'tierRating',
      credit_check_status: 'creditCheckStatus', creditCheckStatus: 'creditCheckStatus',
      fillability_score: 'fillabilityScore', fillabilityScore: 'fillabilityScore',
      vetting_notes: 'vettingNotes', vettingNotes: 'vettingNotes',
      onboarding_status: 'onboardingStatus', onboardingStatus: 'onboardingStatus',
      msa_signed: 'msaSigned', msaSigned: 'msaSigned',
      sow_executed: 'sowExecuted', sowExecuted: 'sowExecuted',
      coi_received: 'coiReceived', coiReceived: 'coiReceived',
      vendor_portal_created: 'vendorPortalCreated', vendorPortalCreated: 'vendorPortalCreated',
    };

    let hasUpdates = false;
    for (const [key, prismaField] of Object.entries(fieldMap)) {
      if (dto[key] !== undefined) {
        data[prismaField] = dto[key];
        hasUpdates = true;
      }
    }

    if (!hasUpdates) {
      return this.findOneClient(id, tenantId);
    }

    await this.prisma.client.update({
      where: { id },
      data,
    });

    return this.findOneClient(id, tenantId);
  }

  async deleteClient(id: string, tenantId: string, modifiedBy?: string) {
    this.logger.log(`Soft deleting client ${id} for tenant ${tenantId}`);
    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Client with ID ${id} not found or already deleted`);
    }

    await this.prisma.client.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        modifiedBy: modifiedBy || 'System',
      },
    });
    return true;
  }

  async restoreClient(id: string, tenantId: string, modifiedBy?: string) {
    this.logger.log(`Restoring client ${id} for tenant ${tenantId}`);
    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!existing) {
      throw new NotFoundException(`Client with ID ${id} not found or not deleted`);
    }

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        deletedAt: null,
        modifiedBy: modifiedBy || 'System',
      },
    });

    return this.formatClient(updated);
  }

  async isClientApproved(clientNameOrId: string, tenantId: string): Promise<{ approved: boolean; status: string; clientName: string }> {
    if (!clientNameOrId || !clientNameOrId.trim()) {
      return { approved: true, status: 'Active', clientName: '' };
    }
    const lookup = clientNameOrId.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup);

    const client = await this.prisma.client.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          ...(isUuid ? [{ id: lookup }] : []),
          { clientName: { equals: lookup, mode: 'insensitive' } },
          { clientCode: { equals: lookup, mode: 'insensitive' } },
        ],
      },
      select: { id: true,  status: true, approvalStatus: true },
    });

    if (!client) {
      return { approved: false, status: 'Not Found', clientName: lookup };
    }

    const isApproved =
      (client.approvalStatus === 'APPROVED' || !client.approvalStatus) &&
      client.status !== 'Pending Approval' &&
      client.status !== 'Rejected';

    return {
      approved: isApproved,
      status: client.status || (client.approvalStatus === 'PENDING_APPROVAL' ? 'Pending Approval' : 'Active'),
      clientName: '',
    };
  }
}
