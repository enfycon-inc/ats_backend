import { RESUME_FILE_SELECT } from '../resume-storage/resume-storage.service';
import { CandidatesService } from './candidates.service';

describe('candidate profile resume lookup', () => {
  it('reads a folder-backed resume after tenant authorization without selecting database file bytes', async () => {
    const findFirst = jest.fn().mockResolvedValue({ resumeRecord: { id: 'resume', storageKey: 'private-reference' } });
    const read = jest.fn().mockResolvedValue({ data: Buffer.from('folder-file'), mime: 'application/pdf', filename: 'CV.pdf' });
    const db: any = { candidate: { findFirst }, resume: { findUnique: jest.fn() } };
    const service = new CandidatesService(db, {} as any, { read } as any);
    expect((await service.getResumeFile('candidate', 'tenant')).data.toString()).toBe('folder-file');
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'candidate', tenantId: 'tenant', deletedAt: null });
    expect(JSON.stringify(findFirst.mock.calls[0][0])).not.toContain('fileData');
    expect(db.resume.findUnique).not.toHaveBeenCalled();
  });
  it('streams the current linked resume and excludes deleted and other-tenant candidates', async () => {
    const findFirst = jest.fn().mockResolvedValue({ resumeRecord: { fileData: Buffer.from('latest'), fileMime: 'application/pdf', filename: 'latest.pdf' } });
    const service = new CandidatesService({ candidate: { findFirst } } as any, {} as any);
    const file = await service.getResumeFile('candidate-uuid', 'tenant-uuid');
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'candidate-uuid', tenantId: 'tenant-uuid', deletedAt: null }, select: { resumeRecord: { select: RESUME_FILE_SELECT } } });
    expect(file.filename).toBe('latest.pdf');
    expect(file.data.toString()).toBe('latest');
    findFirst.mockResolvedValue(null);
    await expect(service.getResumeFile('candidate-uuid', 'other-tenant')).rejects.toMatchObject({ status: 404 });
  });
  it('reports a missing original resume without manufacturing a file', async () => {
    const service = new CandidatesService({ candidate: { findFirst: jest.fn().mockResolvedValue({ resumeRecord: { fileData: null } }) } } as any, {} as any);
    await expect(service.getResumeFile('candidate-uuid', 'tenant-uuid')).rejects.toMatchObject({ status: 404 });
  });
});
