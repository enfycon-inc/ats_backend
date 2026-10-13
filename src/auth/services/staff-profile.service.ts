import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../interfaces/auth-user.interface';
import type { ProfileDetailsInput, SignatureInput, SignatureDefaultsInput, SignatureSettings, EmailSignature } from '../profile-contract';
import { sanitizeSignature } from '../signature-html';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

@Injectable()
export class StaffProfileService {
  constructor(private readonly prisma: PrismaService) {}

  private async owner(db: Database, actor: AuthUser) {
    if (!actor.dbId || !actor.tenantId) throw new ForbiddenException('A workspace account is required.');
    const users = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM ats.users WHERE id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      AND is_active = true AND is_approved = true FOR UPDATE`);
    if (!users.length) throw new ForbiddenException('Your profile is unavailable in this workspace.');
  }

  async saveDetails(actor: AuthUser, input: ProfileDetailsInput) {
    if (!input || typeof input.fullName !== 'string' || !input.fullName.trim() || input.fullName.trim().length > 255)
      throw new BadRequestException('Enter a name of up to 255 characters.');
    if (typeof input.phone !== 'string' || input.phone.length > 50 ||
      (input.designation !== undefined && (typeof input.designation !== 'string' || input.designation.length > 255)))
      throw new BadRequestException('Enter valid profile details.');
    if (Object.keys(input).some(key => !['fullName', 'phone', 'designation'].includes(key)))
      throw new BadRequestException('Only personal profile details can be changed here.');
    const phone = input.phone.trim();
    if (phone && !isValidPhoneNumber(phone)) throw new BadRequestException('Enter a valid phone number with country code.');
    const normalizedPhone = phone ? parsePhoneNumberFromString(phone)!.number : null;
    const designation = input.designation?.trim() || null;
    await this.prisma.$transaction(async tx => {
      await this.owner(tx, actor);
      await tx.$executeRaw(Prisma.sql`UPDATE ats.users SET full_name = ${input.fullName.trim()}, updated_at = NOW()
        WHERE id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO ats.user_profiles (user_id, tenant_id, phone, designation)
        VALUES (${actor.dbId}::uuid, ${actor.tenantId}::uuid, ${normalizedPhone}, ${designation})
        ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, designation = EXCLUDED.designation, updated_at = NOW()`);
    });
    return { saved: true };
  }

  async savePhoto(actor: AuthUser, file?: { buffer: Buffer; size: number }) {
    if (!file || !file.buffer?.length || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Choose a JPG, PNG, or WebP photo up to 5 MB.');
    let data: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 20_000_000, animated: false });
      const info = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(info.format || '') || (info.pages || 1) > 1) throw new Error('Unsupported image');
      // Decode, resize and re-encode: removes EXIF and all uploaded executable/extra payloads.
      data = await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
      if (data.length > 524288) throw new Error('Image too large');
    } catch { throw new BadRequestException('This photo could not be read. Choose a valid JPG, PNG, or WebP image.'); }
    const avatar = `/api/profile-photo/${actor.dbId}?v=${randomUUID()}`;
    await this.prisma.$transaction(async tx => {
      await this.owner(tx, actor);
      await tx.$executeRaw(Prisma.sql`INSERT INTO ats.user_photos (user_id, tenant_id, data)
        VALUES (${actor.dbId}::uuid, ${actor.tenantId}::uuid, ${data})
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`);
      await tx.$executeRaw(Prisma.sql`UPDATE ats.users SET profile_picture = ${avatar}, updated_at = NOW()
        WHERE id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
    });
    return { avatar };
  }

  async removePhoto(actor: AuthUser) {
    await this.prisma.$transaction(async tx => {
      await this.owner(tx, actor);
      await tx.$executeRaw(Prisma.sql`DELETE FROM ats.user_photos WHERE user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
      await tx.$executeRaw(Prisma.sql`UPDATE ats.users SET profile_picture = NULL, updated_at = NOW()
        WHERE id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
    });
    return { avatar: null };
  }

  async photo(actor: AuthUser, userId: string) {
    // Tenant-bound authenticated delivery; no public avatar directory or bearer tokens in URLs.
    const photos = await this.prisma.$queryRaw<{ data: Buffer }[]>(Prisma.sql`
      SELECT p.data FROM ats.user_photos p JOIN ats.users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
      WHERE p.user_id = ${userId}::uuid AND p.tenant_id = ${actor.tenantId}::uuid AND u.is_active = true`);
    if (!photos.length) throw new NotFoundException('Photo not found.');
    return photos[0].data;
  }

  async signatures(actor: AuthUser): Promise<SignatureSettings> {
    if (!actor.dbId || !actor.tenantId) throw new ForbiddenException('A workspace account is required.');
    const [signatures, profiles] = await Promise.all([
      this.prisma.$queryRaw<EmailSignature[]>(Prisma.sql`SELECT id, name, html FROM ats.email_signatures
        WHERE user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid ORDER BY name, id`),
      this.prisma.$queryRaw<SignatureDefaultsInput[]>(Prisma.sql`
        SELECT new_message_signature_id AS "newMessageSignatureId", reply_signature_id AS "replySignatureId"
        FROM ats.user_profiles WHERE user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`),
    ]);
    return { signatures, newMessageSignatureId: profiles[0]?.newMessageSignatureId || null, replySignatureId: profiles[0]?.replySignatureId || null };
  }

  preview(html: string) {
    if (typeof html !== 'string' || Buffer.byteLength(html) > 32768) throw new BadRequestException('Signature must be smaller than 32 KB.');
    const sanitized = sanitizeSignature(html);
    if (Buffer.byteLength(sanitized) > 32768) throw new BadRequestException('Signature must be smaller than 32 KB.');
    return { html: sanitized };
  }

  async saveSignature(actor: AuthUser, input: SignatureInput) {
    if (!input || !uuid.test(input.id) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80)
      throw new BadRequestException('Enter a signature name of up to 80 characters.');
    const { html } = this.preview(input.html);
    try {
      await this.prisma.$transaction(async tx => {
        await this.owner(tx, actor);
        const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ats.email_signatures
          WHERE id = ${input.id}::uuid AND user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
        if (!existing.length) {
          const count = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS count FROM ats.email_signatures WHERE user_id = ${actor.dbId}::uuid`);
          if (count[0].count >= 20) throw new BadRequestException('You can save up to 20 signatures.');
          await tx.$executeRaw(Prisma.sql`INSERT INTO ats.email_signatures (id, user_id, tenant_id, name, html)
            VALUES (${input.id}::uuid, ${actor.dbId}::uuid, ${actor.tenantId}::uuid, ${input.name.trim()}, ${html})`);
        } else {
          await tx.$executeRaw(Prisma.sql`UPDATE ats.email_signatures SET name = ${input.name.trim()}, html = ${html}, updated_at = NOW()
            WHERE id = ${input.id}::uuid AND user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '23505')
        throw new ConflictException('A signature with this name already exists. Choose another name.');
      throw error;
    }
    return this.signatures(actor);
  }

  async saveDefaults(actor: AuthUser, input: SignatureDefaultsInput) {
    if (!input || ![input.newMessageSignatureId, input.replySignatureId].every(id => id === null || (typeof id === 'string' && uuid.test(id))))
      throw new BadRequestException('Choose a saved signature or None.');
    await this.prisma.$transaction(async tx => {
      await this.owner(tx, actor);
      const ids = [...new Set([input.newMessageSignatureId, input.replySignatureId].filter((id): id is string => !!id))];
      if (ids.length) {
        const signatures = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ats.email_signatures
          WHERE user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})`);
        if (signatures.length !== ids.length) throw new BadRequestException('Choose one of your saved signatures.');
      }
      await tx.$executeRaw(Prisma.sql`INSERT INTO ats.user_profiles (user_id, tenant_id, new_message_signature_id, reply_signature_id)
        VALUES (${actor.dbId}::uuid, ${actor.tenantId}::uuid, ${input.newMessageSignatureId}::uuid, ${input.replySignatureId}::uuid)
        ON CONFLICT (user_id) DO UPDATE SET new_message_signature_id = EXCLUDED.new_message_signature_id,
        reply_signature_id = EXCLUDED.reply_signature_id, updated_at = NOW()`);
    });
    return this.signatures(actor);
  }

  async deleteSignature(actor: AuthUser, id: string) {
    await this.prisma.$transaction(async tx => {
      await this.owner(tx, actor);
      await tx.$executeRaw(Prisma.sql`UPDATE ats.user_profiles
        SET new_message_signature_id = CASE WHEN new_message_signature_id = ${id}::uuid THEN NULL ELSE new_message_signature_id END,
            reply_signature_id = CASE WHEN reply_signature_id = ${id}::uuid THEN NULL ELSE reply_signature_id END
        WHERE user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM ats.email_signatures WHERE id = ${id}::uuid
        AND user_id = ${actor.dbId}::uuid AND tenant_id = ${actor.tenantId}::uuid`);
    });
    return this.signatures(actor);
  }

  async appendDefault(tenantId: string, userId: string, body: string, kind: 'new' | 'reply' = 'new', selectedId?: string | null): Promise<string> {
    if (selectedId === 'none') return body;
    if (selectedId && !uuid.test(selectedId)) throw new BadRequestException('Choose one of your saved signatures.');
    if (body.includes('data-ats-signature="')) return body;
    const signatures = await this.prisma.$queryRaw<{ id: string; html: string }[]>(Prisma.sql`
      SELECT s.id, s.html FROM ats.email_signatures s
      WHERE s.user_id = ${userId}::uuid AND s.tenant_id = ${tenantId}::uuid
      AND s.id = ${selectedId ? Prisma.sql`${selectedId}::uuid` : Prisma.sql`(SELECT ${kind === 'reply' ? Prisma.sql`reply_signature_id` : Prisma.sql`new_message_signature_id`}
        FROM ats.user_profiles WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid)`}`);
    if (!signatures.length && selectedId) throw new BadRequestException('Choose one of your saved signatures.');
    if (!signatures.length || !signatures[0].html) return body;
    const signature = `<div data-ats-signature="${signatures[0].id}" style="font-family:Arial,sans-serif;font-size:12px"><br>${sanitizeSignature(signatures[0].html)}</div>`;
    return /<\/body\s*>/i.test(body) ? body.replace(/<\/body\s*>/i, `${signature}</body>`) : body + signature;
  }
}
