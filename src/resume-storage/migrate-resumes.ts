import { PrismaClient } from '@prisma/client';
import { ResumeStorageService, resumeDigest } from './resume-storage.service';

/** Copy-only, restartable migration. Never clears file_data, deletes rows/files, or changes candidate links. */
export async function copyResumeFiles(db: PrismaClient, storage: ResumeStorageService, apply = false, batchSize = 10) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('Batch size must be between 1 and 50.');
  const result = { scanned: 0, copied: 0, verified: 0, pending: 0, bytes: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.resume.findMany({
      where: { fileData: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: batchSize,
      select: { id: true, fileData: true, storageKey: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const source = row.fileData!;
      result.scanned++; result.bytes += source.length;
      const expectedKey = `${row.id.slice(0, 2)}/${row.id}/${resumeDigest(source)}`;
      if (row.storageKey && row.storageKey !== expectedKey) throw new Error(`Storage reference conflict for resume ${row.id}; no existing data changed.`);
      if (!apply) {
        if (row.storageKey) { await storage.verify(row.storageKey, source); result.verified++; }
        else result.pending++;
        continue;
      }
      const copied = await storage.store(row.id, source);
      if (row.storageKey) { result.verified++; continue; }
      const saved = await db.resume.updateMany({
        where: { id: row.id, storageKey: null, fileData: { equals: source } },
        data: { storageKey: copied.storageKey },
      });
      if (saved.count !== 1) throw new Error(`Resume ${row.id} changed during migration; all copies preserved. Retry after review.`);
      result.copied++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !/^--batch-size=\d+$/.test(arg))) throw new Error('Usage: migrate-resumes [--apply] [--batch-size=10]. Default is read-only verification.');
  const db = new PrismaClient();
  try {
    const snapshots = () => db.$queryRaw<Array<{ records: bigint; originals: bigint; bytes: bigint }>>`
      SELECT COUNT(*) AS records,COUNT(file_data) AS originals,COALESCE(SUM(octet_length(file_data)),0)::bigint AS bytes FROM ats.resumes`;
    const before = (await snapshots())[0];
    const result = await copyResumeFiles(db, new ResumeStorageService(), args.includes('--apply'), Number(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || 10));
    const after = (await snapshots())[0];
    if (after.records < before.records || after.originals < before.originals || after.bytes < before.bytes) throw new Error('Source totals decreased during execution. Investigate concurrent changes. This migration contains no deletion operations.');
    console.log(JSON.stringify({ mode: args.includes('--apply') ? 'copy-and-reference' : 'read-only', ...result,
      originalRecordsBefore: String(before.originals), originalRecordsAfter: String(after.originals),
      originalBytesBefore: String(before.bytes), originalBytesAfter: String(after.bytes), databaseOriginalsPreserved: true }));
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : 'Resume migration failed.'); process.exitCode = 1; });
