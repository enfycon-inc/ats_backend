import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { storeTenantLogo, LOGO_URL_PREFIX } from './logo-storage';
import { AuthTenantService } from '../services/auth-tenant.service';

const tenantId = '737f666b-916a-4e9c-91bd-b2bd37e475d1';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${png}`;

describe('company logo file storage', () => {
  let directory: string;
  const previousDirectory = process.env.LOGO_STORAGE_DIR;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ats-logo-test-'));
    process.env.LOGO_STORAGE_DIR = directory;
  });
  afterEach(async () => {
    if (previousDirectory === undefined) delete process.env.LOGO_STORAGE_DIR;
    else process.env.LOGO_STORAGE_DIR = previousDirectory;
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the original bytes and stores only a link through the settings service', async () => {
    const query = jest.fn(async (_sql: string, params: any[]) => ({ rows: [{ logo_url: params[1] }] }));
    const result = await new AuthTenantService({ query } as any, {} as any, {} as any)
      .updateTenantSettings(tenantId, { logoUrl: dataUrl });
    expect(result.logo_url).toMatch(new RegExp(`^${LOGO_URL_PREFIX}/${tenantId}/[a-f0-9]{64}\\.png$`));
    const diskPath = join(directory, result.logo_url.slice(LOGO_URL_PREFIX.length));
    expect(await readFile(diskPath)).toEqual(Buffer.from(png, 'base64'));
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
      `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`,
    ]) {
      await expect(storeTenantLogo(tenantId, input)).rejects.toThrow();
    }
  });

  it('keeps empty branding as the platform fallback', async () => {
    expect(await storeTenantLogo(tenantId, '')).toBe('');
  });
});
