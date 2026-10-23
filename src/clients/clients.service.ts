import { clientAccessSelect, loadPocPolicy, protectClientContactFields } from './poc-access';
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { clientReadWhere, clientJobReadWhere } from './client-visibility';
import { clientCreationErrors, normalizeContactInput, normalizeClientMarket, normalizeClientName, type ClientCreationContext, type ClientCreationRequest } from './client-creation.contract';
import { assertClientMarket, resolveClientCreationContext } from './client-market-policy';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getVisibilityPolicy(actor: AuthUser) {
    if (!actor.permissions?.includes('tenant:settings')) throw new ForbiddenException('Tenant settings permission is required.');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: clientAccessSelect });
    if (!tenant) throw new NotFoundException('Workspace not found.');
    return tenant;
  }

  async setVisibilityPolicy(actor: AuthUser, input: unknown) {
    if (!actor.permissions?.includes('tenant:settings')) throw new ForbiddenException('Tenant settings permission is required.');
    const changes: Record<string, boolean> = {};
    if (typeof input === 'boolean') changes.clientsVisibleAcrossUnits = input;
    else if (input && typeof input === 'object' && !Array.isArray(input)) {
      for (const [key, value] of Object.entries(input)) {
        if (!(key in clientAccessSelect) || typeof value !== 'boolean') throw new BadRequestException('Client access settings must be enabled or disabled.');
        changes[key] = value;
      }
    } else throw new BadRequestException('Client visibility must be enabled or disabled.');
    if (!Object.keys(changes).length) throw new BadRequestException('Select at least one client access setting.');
    return this.prisma.$transaction(async tx => {
      const previous = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: clientAccessSelect });
      if (!previous) throw new NotFoundException('Workspace not found.');
      const saved = await tx.tenant.update({ where: { id: actor.tenantId }, data: changes, select: clientAccessSelect });
      if (Object.entries(changes).some(([key, value]) => previous[key] !== value)) await tx.auditLog.create({ data: {
        tenantId: actor.tenantId, actorId: actor.dbId, actorEmail: actor.email,
        action: 'CLIENT_VISIBILITY_CHANGED', targetType: 'Tenant', targetId: actor.tenantId,
        details: { previous, changes },
      } });
      return saved;
    });
  }

  async protectResponse(client: Record<string, any>, actor: AuthUser) {
    const policy = await loadPocPolicy(this.prisma, actor.tenantId);
    return protectClientContactFields(client, actor, policy);
  }

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
      primaryOwnerId: client.primaryOwner,
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
      commission_percentage: client.commissionPercentage,
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

  getCreationContext(tenantId: string, actor: AuthUser, branchId?: string) {
    return resolveClientCreationContext(this.prisma, tenantId, actor, branchId);
  }

  async createClient(dto: ClientCreationRequest, tenantId: string, createdBy: string, actor: AuthUser) {
    this.validateActorId(createdBy);
    if (createdBy !== actor.dbId) throw new ForbiddenException('Client ownership must match the authenticated user.');
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('Enter valid client details.');
    const context = await this.getCreationContext(tenantId, actor, dto.branch_id);
    assertClientMarket(dto, context);
    if (dto.business_unit_id !== undefined && dto.business_unit_id !== context.businessUnitId) throw new ForbiddenException('The staffing unit has changed. Reload the form.');
    const errors = clientCreationErrors(dto);
    if (Object.keys(errors).length) throw new BadRequestException(Object.values(errors)[0]);
    if (dto.contact) dto = { ...dto, contact: normalizeContactInput(dto.contact) };
    this.validateActorId(dto.request_id);
    return this.prisma.$transaction(async tx => {
      // Stable request UUID handles retries; the name lock serializes duplicate checks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + dto.request_id}, 0))`;
      const service = new ClientsService(tx as unknown as PrismaService);
      const saved = await tx.client.findFirst({ where: { id: dto.request_id, tenantId, createdBy, deletedAt: null } });
      if (saved) {
        if (saved.clientName !== dto.client_name.trim()) throw new ConflictException('This request has already created another client.');
        return service.formatClient(saved);
      }
      const nameKey = normalizeClientName(dto.client_name);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':client:' + nameKey}, 0))`;
      return service.createClientRecord({ ...dto, client_name: dto.client_name.trim() }, tenantId, createdBy, context);
    });
  }

  private async createClientRecord(dto: ClientCreationRequest, tenantId: string, createdBy: string, context: ClientCreationContext) {
    this.logger.log(`Creating client for tenant ${tenantId}`);
    this.validateActorId(createdBy);
    const creator = await this.prisma.user.findFirst({
      where: { id: createdBy, tenantId },
      select: { id: true, jobReviewerId: true },
    });
    if (!creator) throw new ForbiddenException('The authenticated user does not belong to this workspace.');

    // --- Duplicate Client Name Check (Fuzzy Matching) ---
    if (dto.client_name) {
      const normalizedInput = normalizeClientName(dto.client_name);

      const existingClients = await this.prisma.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { clientName: true },
      });

      const duplicate = existingClients.find(
        (c) => normalizeClientName(c.clientName) === normalizedInput
      );

      if (duplicate) {
        throw new ConflictException('A similar client already exists in this workspace. Select the existing account or contact your account manager.');
      }
    }
    // --------------------------------------------------

    // Fetch tenant details first
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { prefixCode: true, name: true, domain: true },
    });

    let clientCode: string;
    {
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


    // Resolve creator permissions and reviewer for client approval gate
    let initialStatus = 'Active';
    let approvalStatus = 'APPROVED';
    let assignedApproverId: string | null = null;
    let approvedBy: string | null = creator.id;
    let approvedAt: Date | null = new Date();

    const hasDirectAddPerm = context.canDirectAdd;

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
        id: dto.request_id, tenantId, clientCode, clientName: dto.client_name,
        clientShortName: dto.client_short_name || null, category: dto.category,
        primaryOwner: context.ownerId, ownership: context.ownerId, createdBy, modifiedBy: createdBy,
        businessUnit: context.businessUnitName || context.branchName, branchId: context.branchId,
        market: context.market, currency: context.currency,
        website: dto.website || null, emailId: dto.email_id || null, industry: dto.industry || null,
        country: dto.country || null, state: dto.state || null, city: dto.city || null,
        address: dto.address || null, postalCode: dto.postal_code || null, aboutCompany: dto.about_company || null,
        paymentTerms: dto.payment_terms || null, commissionPercentage: dto.commission_percentage ?? null,
        federalId: context.market === 'US' ? dto.federal_id || null : null,
        gstin: context.market === 'INDIA' ? dto.gstin || null : null,
        panNumber: context.market === 'INDIA' ? dto.pan_number || null : null,
        tierRating: dto.tier_rating || null, creditCheckStatus: dto.credit_check_status || 'PENDING_CHECK',
        fillabilityScore: dto.fillability_score || null, vettingNotes: dto.vetting_notes || null,
        msaSigned: dto.msa_signed ?? false, sowExecuted: dto.sow_executed ?? false,
        coiReceived: dto.coi_received ?? false, vendorPortalCreated: dto.vendor_portal_created ?? false,
        status: initialStatus, approvalStatus, assignedApproverId, approvedBy, approvedAt,
        ...(dto.contact ? { clientContacts: { create: {
          tenantId, createdBy, name: dto.contact.name!, email: dto.contact.email!,
          designation: dto.contact.designation || null, phone: dto.contact.phone || null, isPrimary: true,
        } } } : {}),
      },
    });

    return this.formatClient(created);
  }

  async findAllClients(tenantId: string, user: AuthUser, includeDeleted = false) {
    const where: any = await clientReadWhere(this.prisma, tenantId, user);
    if (!includeDeleted) {
      where.deletedAt = null;
    }

    const [clients, jobs] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.findMany({
        where: { ...clientJobReadWhere(tenantId, user), deletedAt: null },
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

    const policy = await loadPocPolicy(this.prisma, tenantId);
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

      return this.formatClient(protectClientContactFields(c, user, policy), {
        primaryOwnerName,
        activeJobsCount,
      });
    });
  }

  async findOneClient(id: string, tenantId: string, actor: AuthUser) {
    const access = await clientReadWhere(this.prisma, tenantId, actor);
    return this.loadClientProfile(id, tenantId, access, actor);
  }

  private async loadClientProfile(id: string, tenantId: string, access: any, actor?: AuthUser) {
    const client = await this.prisma.client.findFirst({
      where: { ...access, id, deletedAt: null },
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
        ...(actor ? clientJobReadWhere(tenantId, actor) : { tenantId }),
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

    const policy = actor ? await loadPocPolicy(this.prisma, tenantId) : null;
    return this.formatClient(actor ? protectClientContactFields(client, actor, policy) : client, {
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

    if ((dto.market !== undefined && (!normalizeClientMarket(dto.market) || normalizeClientMarket(dto.market) !== normalizeClientMarket(existing.market))) ||
        (dto.currency !== undefined && dto.currency !== existing.currency)) {
      throw new BadRequestException('Client market and currency cannot be changed from the client form.');
    }
    if (dto.branch_id !== undefined || dto.branchId !== undefined) {
      const branchId = dto.branch_id ?? dto.branchId;
      if (branchId !== existing.branchId) throw new BadRequestException('Client branch transfers require a separate authorized workflow.');
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
      end_client_name: 'endClientName', endClientName: 'endClientName',
      is_same_as_primary: 'isSameAsPrimary', isSameAsPrimary: 'isSameAsPrimary',
      contact_person: 'contactPerson', contactPerson: 'contactPerson',
      contact_designation: 'contactDesignation', contactDesignation: 'contactDesignation',
      gstin: 'gstin',
      pan_number: 'panNumber', panNumber: 'panNumber',
      tier_rating: 'tierRating', tierRating: 'tierRating',
      commission_percentage: 'commissionPercentage', commissionPercentage: 'commissionPercentage',
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
      return this.loadClientProfile(id, tenantId, { tenantId }, user);
    }

    await this.prisma.client.update({
      where: { id },
      data,
    });

    return this.loadClientProfile(id, tenantId, { tenantId }, user);
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
