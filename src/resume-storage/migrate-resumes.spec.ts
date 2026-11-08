import { copyResumeFiles } from './migrate-resumes';
import { resumeDigest } from './resume-storage.service';
const id = '12345678-1234-4234-8234-123456789abc';
describe('copy-only resume migration', () => {
  function setup(storageKey: string | null = null) {
    const source = Buffer.from('preserve-original'); const key = `12/${id}/${resumeDigest(source)}`;
    const db: any = { resume: { findMany: jest.fn().mockResolvedValueOnce([{ id, fileData: source, storageKey }]).mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), delete: jest.fn() } };
    const storage: any = { store: jest.fn().mockResolvedValue({ storageKey: key }), verify: jest.fn() };
    return { db, storage, source, key };
  }
  it('defaults to a read-only inventory without creating files or changing records', async () => {
    const { db, storage } = setup(); const result = await copyResumeFiles(db, storage);
    expect(result.pending).toBe(1); expect(storage.store).not.toHaveBeenCalled(); expect(db.resume.updateMany).not.toHaveBeenCalled();
  });
  it('sets only a verified file reference while preserving source bytes and candidate links', async () => {
    const { db, storage, source, key } = setup(); await copyResumeFiles(db, storage, true);
    expect(storage.store).toHaveBeenCalledWith(id, source);
    expect(db.resume.updateMany).toHaveBeenCalledWith({ where: { id, storageKey: null, fileData: { equals: source } }, data: { storageKey: key } });
    expect(source.toString()).toBe('preserve-original'); expect(db.resume.delete).not.toHaveBeenCalled();
  });
  it('does not update references when file verification fails', async () => {
    const { db, storage } = setup(); storage.store.mockRejectedValue(new Error('conflict'));
    await expect(copyResumeFiles(db, storage, true)).rejects.toThrow('conflict'); expect(db.resume.updateMany).not.toHaveBeenCalled();
  });
  it('stops on a conflicting existing reference without overwriting it', async () => {
    const { db, storage } = setup('existing-reference');
    await expect(copyResumeFiles(db, storage, true)).rejects.toThrow('conflict'); expect(storage.store).not.toHaveBeenCalled(); expect(db.resume.updateMany).not.toHaveBeenCalled();
  });
  it('detects concurrent record changes and leaves both copies for review', async () => {
    const { db, storage } = setup(); db.resume.updateMany.mockResolvedValue({ count: 0 });
    await expect(copyResumeFiles(db, storage, true)).rejects.toThrow('changed during migration'); expect(db.resume.delete).not.toHaveBeenCalled();
  });
});
