const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tid = '737f666b-916a-4e9c-91bd-b2bd37e475d1';

  const us = await prisma.marketSegment.upsert({
    where: { tenantId_code: { tenantId: tid, code: 'USIT' } },
    update: {},
    create: {
      tenantId: tid,
      name: 'US IT Staffing',
      code: 'USIT',
      defaultCurrency: 'USD',
      defaultTimezone: 'America/New_York',
      defaultShift: 'US Shift',
      defaultStartTime: '18:30',
      defaultEndTime: '03:30',
      sortOrder: 1,
    },
  });

  const dom = await prisma.marketSegment.upsert({
    where: { tenantId_code: { tenantId: tid, code: 'DOM' } },
    update: {},
    create: {
      tenantId: tid,
      name: 'Domestic India',
      code: 'DOM',
      defaultCurrency: 'INR',
      defaultTimezone: 'Asia/Kolkata',
      defaultShift: 'General Shift',
      defaultStartTime: '09:30',
      defaultEndTime: '18:30',
      sortOrder: 2,
    },
  });

  // Link existing US IT unit to the US IT Staffing market segment
  await prisma.businessUnit.update({
    where: { id: '9ae294aa-5b85-4b0c-8f17-d96bc7e2a769' },
    data: { marketSegmentId: us.id },
  });

  console.log('Seeded successfully:', JSON.stringify({ us: us.id, dom: dom.id }));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
