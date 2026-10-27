import { EmailProcessor } from './email.processor';

describe('EmailProcessor local delivery safeguard', () => {
  const originalFlag = process.env.LOCAL_DISABLE_OUTBOUND_EMAILS;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.LOCAL_DISABLE_OUTBOUND_EMAILS;
    else process.env.LOCAL_DISABLE_OUTBOUND_EMAILS = originalFlag;
  });

  it('skips outbound mail when local delivery is disabled', async () => {
    process.env.LOCAL_DISABLE_OUTBOUND_EMAILS = 'true';
    const email = { sendMicrosoftEmail: jest.fn() } as any;
    const prisma = { recipients: { findUnique: jest.fn(), update: jest.fn() } } as any;
    const processor = new EmailProcessor(email, prisma);
    const result = await processor.process({ name: 'send_email', data: {} } as any);

    expect(result).toEqual({ skipped: true });
    expect(email.sendMicrosoftEmail).not.toHaveBeenCalled();
    expect(prisma.recipients.findUnique).not.toHaveBeenCalled();
  });
});
