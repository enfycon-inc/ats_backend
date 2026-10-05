import { PrismaClient } from '@prisma/client';
import { ClientsService } from './src/clients/clients.service';
import { Logger } from '@nestjs/common';
import { MailService } from './src/email/mail.service';
import { NotificationService } from './src/notifications/notification.service';
import { PrismaService } from './src/prisma/prisma.service';

const prisma = new PrismaClient() as any;

async function main() {
  const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33'; // from .env DEFAULT_TENANT_ID

  const payload = {
    client_name: "Test Audit Client 2",
    email_id: "test2@enfycon.com",
    status: "Active",
    country: "India",
    city: "Bhubneswar",
    ownership: "Rajesh Gupta",
    about_company: null,
    commission_percentage: 8.33,
    msa_signed: true,
    sow_executed: true,
    payment_terms: "Immediate"
  };

  const mockMailService = {} as MailService;
  const mockNotificationService = {} as NotificationService;
  const mockPrismaService = prisma as PrismaService;

  const service = new ClientsService(mockPrismaService, mockMailService, mockNotificationService);
  
  try {
    const created = await service.createClient(payload, tenantId, 'System');
    console.log("Success:", created.id);
  } catch (e: any) {
    console.log("Service Error:");
    console.log(e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
