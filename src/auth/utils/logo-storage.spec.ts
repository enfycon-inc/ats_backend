import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { storeTenantLogo, optimizeLogo, LOGO_URL_PREFIX } from './logo-storage';
import { AuthTenantService } from '../services/auth-tenant.service';

const tenantId = '737f666b-916a-4e9c-91bd-b2bd37e475d1';
let dataUrl: string;

describe('company logo file storage', () => {
  let directory: string;
  const previousDirectory = process.env.LOGO_STORAGE_DIR;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ats-logo-test-'));
    process.env.LOGO_STORAGE_DIR = directory;
    const png = await sharp({ create: { width: 960, height: 192, channels: 4, background: { r: 30, g: 60, b: 120, alpha: 0.8 } } }).png().toBuffer();
    dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  });
  afterEach(async () => {
    if (previousDirectory === undefined) delete process.env.LOGO_STORAGE_DIR;
    else process.env.LOGO_STORAGE_DIR = previousDirectory;
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  });

  it('optimizes the artwork and stores only a link through the settings service', async () => {
    const query = jest.fn(async (_sql: string, params: any[]) => ({ rows: [{ logo_url: params[1] }] }));
    const result = await new AuthTenantService({ query } as any, {} as any, {} as any)
      .updateTenantSettings(tenantId, { logoUrl: dataUrl });
    expect(result.logo_url).toMatch(new RegExp(`^${LOGO_URL_PREFIX}/${tenantId}/[a-f0-9]{64}\\.webp$`));
    const diskPath = join(directory, result.logo_url.slice(LOGO_URL_PREFIX.length));
    const bytes = await readFile(diskPath);
    expect(bytes.length).toBeLessThanOrEqual(50 * 1024);
    expect(await sharp(bytes).metadata()).toEqual(expect.objectContaining({ format: 'webp', width: 480, height: 96, hasAlpha: true }));
    expect(query.mock.calls[0][1][1]).not.toContain('base64');
    expect(await storeTenantLogo(tenantId, dataUrl)).toBe(result.logo_url);
    expect(await storeTenantLogo(tenantId, result.logo_url)).toBe(result.logo_url);
  });

  it('rejects executable content, spoofed formats, invalid paths and oversized uploads', async () => {
    for (const input of [
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      '../../outside.png',
      `${LOGO_URL_PREFIX}/00000000-0000-0000-0000-000000000000/${'a'.repeat(64)}.png`,
      `data:image/png;base64,${Buffer.alloc(200 * 1024 + 1).toString('base64')}`,
    ]) {
      await expect(storeTenantLogo(tenantId, input)).rejects.toThrow();
    }
  });

  it('updates either logo independently and does not write settings when one upload is invalid', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{}] });
    const service = new AuthTenantService({ query } as any, {} as any, {} as any);
    await service.updateTenantSettings(tenantId, { loginLogoUrl: dataUrl });
    expect(query.mock.calls[0][0]).toContain('login_logo_url = $2');
    expect(query.mock.calls[0][0]).not.toContain('SET logo_url');
    const file = query.mock.calls[0][1][1] as string;
    const bytes = await readFile(join(directory, file.slice(LOGO_URL_PREFIX.length)));
    expect(await sharp(bytes).metadata()).toEqual(expect.objectContaining({ width: 360, height: 72 }));
    await service.updateTenantSettings(tenantId, { loginLogoUrl: '' });
    expect(query.mock.calls[1][1]).toEqual([tenantId, '']);
    query.mockClear();
    await expect(service.updateTenantSettings(tenantId, { logoUrl: dataUrl, loginLogoUrl: 'invalid' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects truncated images and excessive decoded dimensions', async () => {
    await expect(storeTenantLogo(tenantId, 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10]).toString('base64'))).rejects.toThrow();
    const large = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(optimizeLogo(large, 'site')).rejects.toThrow();
  });

  it('does not enlarge small artwork and rejects images that exceed the served-byte cap', async () => {
    const small = await sharp({ create: { width: 24, height: 12, channels: 4, background: 'transparent' } }).png().toBuffer();
    expect(await sharp(await optimizeLogo(small, 'login')).metadata()).toEqual(expect.objectContaining({ width: 24, height: 12 }));
    const pixels = Buffer.alloc(480 * 96 * 4);
    let seed = 123456789;
    for (let index = 0; index < pixels.length; index++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels[index] = seed & 255;
    }
    const noisy = await sharp(pixels, { raw: { width: 480, height: 96, channels: 4 } }).png().toBuffer();
    expect(noisy.length).toBeLessThan(200 * 1024);
    await expect(storeTenantLogo(tenantId, 'data:image/png;base64,' + noisy.toString('base64'))).rejects.toThrow('50 KB');
  }, 15000);

  it('keeps empty branding as the platform fallback', async () => {
    expect(await storeTenantLogo(tenantId, '')).toBe('');
  });
});
