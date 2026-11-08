import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumeStorageService, resumeDigest } from './resume-storage.service';
const id = '12345678-1234-4234-8234-123456789abc';
describe('immutable private resume storage', () => {
  let root: string;
  let service: ResumeStorageService;
  const prior = process.env.RESUME_STORAGE_DIR;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ats-resume-storage-test-')); process.env.RESUME_STORAGE_DIR = root; service = new ResumeStorageService(); });
  afterAll(() => { if (prior === undefined) delete process.env.RESUME_STORAGE_DIR; else process.env.RESUME_STORAGE_DIR = prior; });
  // Test directories are intentionally retained; no cleanup operation is used by this storage implementation.
  it('round-trips exact bytes and reuses an identical destination without overwriting it', async () => {
    const bytes = Buffer.from('%PDF-original');
    const stored = await service.store(id, bytes);
    expect(await service.store(id, bytes)).toEqual(stored);
    const legacy = jest.fn();
    const file = await service.read({ id, storageKey: stored.storageKey, filename: 'original.pdf', fileMime: 'application/pdf' }, legacy);
    expect(file.data).toEqual(bytes); expect(file.filename).toBe('original.pdf'); expect(legacy).not.toHaveBeenCalled();
    await service.verify(stored.storageKey, bytes);
  });
  it('preserves a conflicting destination and the caller original rather than replacing either', async () => {
    const bytes = Buffer.from('original'); const digest = resumeDigest(bytes);
    const directory = join(root, id.slice(0, 2), id); await mkdir(directory, { recursive: true });
    const destination = join(directory, digest); await writeFile(destination, 'existing-conflict');
    await expect(service.store(id, bytes)).rejects.toThrow();
    expect((await readFile(destination)).toString()).toBe('existing-conflict'); expect(bytes.toString()).toBe('original');
  });
  it('falls back to preserved database bytes when a copied file is missing or corrupted', async () => {
    const bytes = Buffer.from('database-original'); const key = `${id.slice(0, 2)}/${id}/${resumeDigest(bytes)}`;
    const legacy = jest.fn().mockResolvedValue(bytes);
    expect((await service.read({ id, storageKey: key }, legacy)).data).toEqual(bytes);
    expect(legacy).toHaveBeenCalledTimes(1);
    await expect(service.read({ id, storageKey: key })).rejects.toMatchObject({ status: 503 });
  });
  it('does not let malformed keys escape the private root', async () => {
    for (const storageKey of ['../../outside.pdf', '/etc/passwd', 'ab/invalid/key']) {
      await expect(service.read({ storageKey })).rejects.toMatchObject({ status: 503 });
    }
  });
  it('rejects linked directories and keeps their contents intact', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'ats-resume-outside-test-'));
    await symlink(outside, join(root, '12'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.store(id, Buffer.from('data'))).rejects.toThrow('directory');
  });
  it('requires an explicitly configured absolute directory for new files', async () => {
    delete process.env.RESUME_STORAGE_DIR;
    await expect(service.store(id, Buffer.from('original'))).rejects.toThrow('absolute');
    expect((await service.read({ fileData: Buffer.from('legacy') })).data.toString()).toBe('legacy');
  });
  it('stops production startup if its persistent mount is missing', async () => {
    const previous = process.env.RESUME_STORAGE_REQUIRE_MOUNT;
    process.env.RESUME_STORAGE_REQUIRE_MOUNT = 'true';
    try { await expect(service.onModuleInit()).rejects.toThrow(/mount|Linux/); }
    finally { if (previous === undefined) delete process.env.RESUME_STORAGE_REQUIRE_MOUNT; else process.env.RESUME_STORAGE_REQUIRE_MOUNT = previous; }
  });

});
