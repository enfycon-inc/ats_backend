import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export const RESUME_FILE_SELECT = { id: true, storageKey: true, filename: true, fileMime: true, fileSize: true, fileHash: true } as const;
type StoredRecord = { id?: string; storageKey?: string | null; filename?: string | null; fileMime?: string | null;
  fileSize?: number | null; fileHash?: string | null; fileData?: Uint8Array | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyPattern = /^([0-9a-f]{2})\/([0-9a-f-]{36})\/([0-9a-f]{64})$/;
export const resumeDigest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Immutable private files. This service deliberately has no delete/overwrite operation. */
@Injectable()
export class ResumeStorageService {
  private readonly logger = new Logger(ResumeStorageService.name);
  async onModuleInit() {
    if (process.env.RESUME_STORAGE_REQUIRE_MOUNT !== 'true') return;
    if (process.platform !== 'linux') throw new Error('Persistent resume mount verification requires Linux.');
    const directory = this.root();
    const mounts = await readFile('/proc/self/mountinfo', 'utf8');
    if (!mounts.split('\n').some(line => line.split(' ')[4] === directory)) {
      throw new Error('The persistent resume directory is not mounted; backend startup stopped to protect uploads.');
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid persistent resume mount.');
  }
  private root() {
    const directory = process.env.RESUME_STORAGE_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error('RESUME_STORAGE_DIR must be an absolute persistent directory.');
    return resolve(directory);
  }
  private async path(key: string, create: boolean) {
    const match = keyPattern.exec(key);
    if (!match || !uuid.test(match[2]) || match[1] !== match[2].slice(0, 2)) throw new Error('Invalid resume storage key.');
    let directory = this.root();
    // Private directories plus symlink rejection prevent keys escaping the configured root.
    for (const part of ['', match[1], match[2]]) {
      if (part) directory = join(directory, part);
      if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid resume storage directory.');
    }
    return join(directory, match[3]);
  }
  async store(id: string, data: Uint8Array) {
    if (!uuid.test(id) || !data.length) throw new Error('Invalid resume file.');
    const hash = resumeDigest(data);
    const storageKey = `${id.slice(0, 2)}/${id}/${hash}`;
    const destination = await this.path(storageKey, true);
    try {
      const file = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Never replace a destination, even after an interrupted write. Verify or stop.
    }
    const verified = await this.readKey(storageKey);
    if (verified.length !== data.length || resumeDigest(verified) !== hash) throw new Error('Resume file verification failed; existing files were preserved.');
    return { storageKey, fileHash: hash, fileSize: data.length };
  }
  private async readKey(key: string) {
    const source = await this.path(key, false);
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid resume file.');
    const file = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let data: Buffer;
    try { data = await file.readFile(); } finally { await file.close(); }
    if (resumeDigest(data) !== key.split('/')[2]) throw new Error('Resume integrity check failed.');
    return data;
  }
  async verify(key: string, expected: Uint8Array) {
    const data = await this.readKey(key);
    if (data.length !== expected.length || resumeDigest(data) !== resumeDigest(expected)) throw new Error('Resume copy does not match the database original.');
  }
  async read(record: StoredRecord | null | undefined, legacy?: () => Promise<Uint8Array | null | undefined>) {
    if (!record) throw new NotFoundException('No stored resume file.');
    let data: Buffer | undefined;
    if (record.storageKey) {
      try { data = await this.readKey(record.storageKey); }
      catch { this.logger.warn('Resume folder read failed; checking the preserved database copy.'); }
    }
    if (!data) {
      const bytes = record.fileData || await legacy?.();
      if (bytes) data = Buffer.from(bytes);
    }
    if (!data) {
      if (record.storageKey) throw new ServiceUnavailableException('Resume file is temporarily unavailable. Contact your administrator.');
      throw new NotFoundException('No stored resume file.');
    }
    return { data, mime: record.fileMime || 'application/octet-stream', filename: record.filename || 'resume' };
  }
}
