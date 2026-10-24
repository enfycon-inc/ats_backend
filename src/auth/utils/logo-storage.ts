import { BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { join } from 'node:path';

export const LOGO_URL_PREFIX = '/public/image/logos';
export const MAX_LOGO_BYTES = 200 * 1024;
export const logoDirectory = () => process.env.LOGO_STORAGE_DIR || join(process.cwd(), 'public', 'image', 'logos');

// Use only inert raster formats. Never use an uploaded filename as a disk path.
export async function storeTenantLogo(tenantId: string, input: string, purpose: 'site' | 'login' = 'site'): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new BadRequestException('Invalid company identifier.');
  if (typeof input !== 'string') throw new BadRequestException('Invalid logo.');
  if (input === '') return '';
  const ownPrefix = `${LOGO_URL_PREFIX}/${tenantId}/`;
  if (input.startsWith(ownPrefix) && /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(input.slice(ownPrefix.length))) return input;

  if (input.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 100) {
    throw new BadRequestException('Logo must be 200 KB or smaller.');
  }
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) throw new BadRequestException('Choose a PNG, JPEG, GIF, or WebP logo.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES || bytes.toString('base64') !== match[2]) {
    throw new BadRequestException('Invalid logo image or image exceeds 200 KB.');
  }
  const mime = match[1];
  const valid = (mime === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (mime === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mime === 'gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    || (mime === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!valid) throw new BadRequestException('The logo contents do not match its image type.');

  return storeOptimizedLogo(tenantId, bytes, purpose);
}

// Maintenance also uses this path for legacy images (up to the former 2 MB limit).
export async function storeOptimizedLogo(tenantId: string, bytes: Buffer, purpose: 'site' | 'login'): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !bytes.length || bytes.length > 2 * 1024 * 1024) {
    throw new BadRequestException('Invalid existing company logo.');
  }
  const ownPrefix = `${LOGO_URL_PREFIX}/${tenantId}/`;
  const optimized = await optimizeLogo(bytes, purpose);
  const name = `${createHash('sha256').update(optimized).digest('hex')}.webp`;
  const directory = join(logoDirectory(), tenantId);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, optimized, { flag: 'wx' });
    await rename(temporary, join(directory, name));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return `${ownPrefix}${name}`;
}

// Decode fully, strip metadata, and bound both decoded pixels and served bytes.
export async function optimizeLogo(bytes: Buffer, purpose: 'site' | 'login'): Promise<Buffer> {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' }).metadata();
    if ((metadata.pages || 1) > 1) throw new BadRequestException('Choose a non-animated logo.');
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' }).rotate()
      .resize({ width: purpose === 'site' ? 480 : 360, height: 96, fit: 'inside', withoutEnlargement: true });
    let result = await image.clone().webp({ lossless: true, effort: 4 }).toBuffer();
    if (result.length > 30 * 1024) {
      const compressed = await image.clone().webp({ quality: 90, alphaQuality: 100, effort: 4 }).toBuffer();
      if (compressed.length < result.length) result = compressed;
    }
    if (result.length > 50 * 1024) throw new BadRequestException('Logo is too detailed. Please choose a simpler image (maximum optimized size 50 KB).');
    return result;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Could not process the logo. Choose a valid PNG, JPEG, GIF, or WebP image.');
  }
}
