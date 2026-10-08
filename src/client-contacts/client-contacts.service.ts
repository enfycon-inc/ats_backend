import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientContactDto } from './dtos/create-client-contact.dto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { clientReadWhere } from '../clients/client-visibility';

@Injectable()
export class ClientContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, tenantId: string, createdById: string, dto: CreateClientContactDto) {
    // Verify client belongs to tenant
    const client = await this.prisma.client.findFirst({ where: { id: clientId, tenantId } });
    if (!client) throw new NotFoundException('Client not found.');

    // If marking as primary, unset existing primary
    if (dto.isPrimary) {
      await this.prisma.clientContact.updateMany({
        where: { clientId, tenantId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const contact = await this.prisma.clientContact.create({
      data: {
        tenantId,
        clientId,
        createdBy: createdById,
        name: dto.name,
        designation: dto.designation || null,
        email: dto.email || null,
        phone: dto.phone || null,
        linkedinUrl: dto.linkedinUrl || null,
        isPrimary: dto.isPrimary ?? false,
        notes: dto.notes || null,
      },
      include: { creator: { select: { id: true, fullName: true, email: true } } },
    });

    return this.formatContact(contact, createdById);
  }

  async findAllForClient(clientId: string, tenantId: string, requestingUserId: string, actor: AuthUser) {
    const access = await clientReadWhere(this.prisma, tenantId, actor);
    const client = await this.prisma.client.findFirst({ where: { ...access, id: clientId, deletedAt: null } });
    if (!client) throw new NotFoundException('Client not found.');

    const contacts = await this.prisma.clientContact.findMany({
      where: { clientId, tenantId },
      include: { creator: { select: { id: true, fullName: true, email: true } } },
      orderBy: [
        { isPrimary: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    // Sort: my contacts first, then others
    const mine = contacts.filter(c => c.createdBy === requestingUserId);
    const others = contacts.filter(c => c.createdBy !== requestingUserId);

    return {
      myContacts: mine.map(c => this.formatContact(c, requestingUserId)),
      otherContacts: others.map(c => this.formatContact(c, requestingUserId)),
    };
  }

  async update(contactId: string, tenantId: string, requestingUserId: string, dto: Partial<CreateClientContactDto>, userPermissions: string[]) {
    const contact = await this.prisma.clientContact.findFirst({ where: { id: contactId, tenantId } });
    if (!contact) throw new NotFoundException('Contact not found.');

    const isOwner = contact.createdBy === requestingUserId;
    const isAdmin = userPermissions?.some(p => ['client:manage', 'tenant:manage', 'platform:manage'].includes(p));
    if (!isOwner && !isAdmin) throw new ForbiddenException('You can only edit contacts you created.');

    if (dto.isPrimary) {
      await this.prisma.clientContact.updateMany({
        where: { clientId: contact.clientId, tenantId, isPrimary: true, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }

    return this.prisma.clientContact.update({
      where: { id: contactId },
      data: { ...dto },
      include: { creator: { select: { id: true, fullName: true, email: true } } },
    });
  }

  async remove(contactId: string, tenantId: string, requestingUserId: string, userPermissions: string[]) {
    const contact = await this.prisma.clientContact.findFirst({ where: { id: contactId, tenantId } });
    if (!contact) throw new NotFoundException('Contact not found.');

    const isOwner = contact.createdBy === requestingUserId;
    const isAdmin = userPermissions?.some(p => ['client:manage', 'tenant:manage', 'platform:manage'].includes(p));
    if (!isOwner && !isAdmin) throw new ForbiddenException('You can only delete contacts you created.');

    await this.prisma.clientContact.delete({ where: { id: contactId } });
    return { message: 'Contact deleted.' };
  }

  private formatContact(contact: any, requestingUserId: string) {
    return {
      id: contact.id,
      clientId: contact.clientId,
      name: contact.name,
      designation: contact.designation,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      isPrimary: contact.isPrimary,
      notes: contact.notes,
      isOwner: contact.createdBy === requestingUserId,
      addedBy: contact.creator ? { id: contact.creator.id, name: contact.creator.fullName } : null,
      createdAt: contact.createdAt,
    };
  }
}


