import { BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LOGO_URL_PREFIX = '/public/image/logos';
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const logoDirectory = () => process.env.LOGO_STORAGE_DIR || join(process.cwd(), 'public', 'image', 'logos');

// Use only inert raster formats. Never use an uploaded filename as a disk path.
export async function storeTenantLogo(tenantId: string, input: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new BadRequestException('Invalid company identifier.');
  if (typeof input !== 'string') throw new BadRequestException('Invalid logo.');
  if (input === '') return '';
  const ownPrefix = `${LOGO_URL_PREFIX}/${tenantId}/`;
  if (input.startsWith(ownPrefix) && /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(input.slice(ownPrefix.length))) return input;

  if (input.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 100) {
    throw new BadRequestException('Logo must be 2 MB or smaller.');
  }
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) throw new BadRequestException('Choose a PNG, JPEG, GIF, or WebP logo.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES || bytes.toString('base64') !== match[2]) {
    throw new BadRequestException('Invalid logo image or image exceeds 2 MB.');
  }
  const mime = match[1];
  const valid = (mime === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (mime === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mime === 'gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    || (mime === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!valid) throw new BadRequestException('The logo contents do not match its image type.');

  const name = `${createHash('sha256').update(bytes).digest('hex')}.${mime === 'jpeg' ? 'jpg' : mime}`;
  const directory = join(logoDirectory(), tenantId);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, join(directory, name));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return `${ownPrefix}${name}`;
}
