import { StaffProfileService } from './staff-profile.service';
import type { AuthUser } from '../interfaces/auth-user.interface';
import sharp from 'sharp';

const userId = 'db13fd7a-9b27-42c5-bab4-af1c05b0b001';
const tenantId = 'db13fd7a-9b27-42c5-bab4-af1c05b0b002';
const signatureId = 'db13fd7a-9b27-42c5-bab4-af1c05b0b003';
const actor: AuthUser = { dbId: userId, tenantId, keycloakId: 'subject', email: 'member@example.com', fullName: 'Member', roles: [], permissions: [], isActive: true };

function setup() {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: userId }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(callback => callback(db));
  return { db, service: new StaffProfileService(db as never) };
}

describe('Personal profile ownership and persistence', () => {
  it('allows an ordinary member to save with phone and designation empty', async () => {
    const { db, service } = setup();
    await service.saveDetails(actor, { fullName: 'Updated Member', phone: '' });
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    const details = db.$executeRaw.mock.calls[1][0];
    expect(details.values).toContain(userId);
    expect(details.values).toContain(tenantId);
    expect(details.values.filter((value: unknown) => value === null)).toHaveLength(2);
    expect(db.$executeRaw.mock.calls[0][0].values).toContain('Updated Member');
  });
  it('normalizes a user-entered phone number and stores an optional designation', async () => {
    const { db, service } = setup();
    await service.saveDetails(actor, { fullName: ' Member ', phone: '+1 202 555 0123', designation: ' Consultant ' });
    expect(db.$executeRaw.mock.calls[1][0].values).toEqual(expect.arrayContaining(['+12025550123', 'Consultant']));
  });
  it('rejects role escalation and writes nothing', async () => {
    const { db, service } = setup();
    await expect(service.saveDetails(actor, { fullName: 'Member', phone: '', roles: ['ADMIN'] } as never)).rejects.toThrow('Only personal');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid phone numbers rather than silently substituting a sample', async () => {
    const { db, service } = setup();
    await expect(service.saveDetails(actor, { fullName: 'Member', phone: 'not a phone' })).rejects.toThrow('valid phone');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('blocks a user who does not belong to the selected workspace', async () => {
    const { db, service } = setup();
    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.saveDetails(actor, { fullName: 'Member', phone: '' })).rejects.toThrow('unavailable in this workspace');
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual([userId, tenantId]);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('Profile photos', () => {
  it('rejects an SVG upload before writing any image', async () => {
    const { db, service } = setup();
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    await expect(service.savePhoto(actor, { buffer, size: buffer.length })).rejects.toThrow('valid JPG');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('resizes a decoded photo to a small WebP and stores a versioned URL', async () => {
    const { db, service } = setup();
    const buffer = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1a4fa0' } }).jpeg().toBuffer();
    const result = await service.savePhoto(actor, { buffer, size: buffer.length });
    const photoData = db.$executeRaw.mock.calls[0][0].values.find(Buffer.isBuffer);
    const metadata = await sharp(photoData).metadata();
    expect(metadata).toMatchObject({ width: 256, height: 256, format: 'webp' });
    expect(metadata.exif).toBeUndefined();
    expect(result.avatar).toMatch(new RegExp(`^/api/profile-photo/${userId}\\?v=`));
  });
  it('does not expose an avatar from another tenant', async () => {
    const { db, service } = setup();
    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.photo(actor, signatureId)).rejects.toThrow('Photo not found');
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual([signatureId, tenantId]);
  });
});

describe('Signature defaults and outgoing mail', () => {
  it('rejects a signature owned by another user as a default', async () => {
    const { db, service } = setup();
    db.$queryRaw.mockResolvedValueOnce([{ id: userId }]).mockResolvedValueOnce([]);
    await expect(service.saveDefaults(actor, { newMessageSignatureId: signatureId, replySignatureId: null })).rejects.toThrow('your saved signatures');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('places the saved signature before the closing HTML body tag', async () => {
    const { db, service } = setup();
    db.$queryRaw.mockResolvedValueOnce([{ id: signatureId, html: '<p><strong>Member</strong></p>' }]);
    const html = await service.appendDefault(tenantId, userId, '<html><body>Hello</body></html>');
    expect(html).toContain(`Hello<div data-ats-signature="${signatureId}"`);
    expect(html).toContain('</div></body></html>');
  });
  it('does not add the same signature twice when an email is reprocessed', async () => {
    const { db, service } = setup();
    const body = `<p>Hello</p><div data-ats-signature="${signatureId}">Member</div>`;
    expect(await service.appendDefault(tenantId, userId, body)).toBe(body);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('supports explicit signature selection even when no default has been saved', async () => {
    const { db, service } = setup();
    db.$queryRaw.mockResolvedValueOnce([{ id: signatureId, html: '<p>Member</p>' }]);
    expect(await service.appendDefault(tenantId, userId, 'Hello', 'new', signatureId)).toContain('Member');
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual([userId, tenantId, signatureId]);
  });
  it('supports None and uses the separate reply default for reply contexts', async () => {
    const { db, service } = setup();
    expect(await service.appendDefault(tenantId, userId, 'Hello', 'new', 'none')).toBe('Hello');
    db.$queryRaw.mockResolvedValueOnce([]);
    await service.appendDefault(tenantId, userId, 'Reply', 'reply');
    expect(db.$queryRaw.mock.calls[0][0].strings.join('')).toContain('reply_signature_id');
  });
});
