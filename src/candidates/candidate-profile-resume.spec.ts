import { CandidatesService } from './candidates.service';

describe('candidate profile resume lookup', () => {
  it('streams the current linked resume and excludes deleted and other-tenant candidates', async () => {
    const findFirst = jest.fn().mockResolvedValue({ resumeRecord: { fileData: Buffer.from('latest'), fileMime: 'application/pdf', filename: 'latest.pdf' } });
    const service = new CandidatesService({ candidate: { findFirst } } as any);
    const file = await service.getResumeFile('candidate-uuid', 'tenant-uuid');
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'candidate-uuid', tenantId: 'tenant-uuid', deletedAt: null }, include: { resumeRecord: true } });
    expect(file.filename).toBe('latest.pdf');
    expect(file.data.toString()).toBe('latest');
    findFirst.mockResolvedValue(null);
    await expect(service.getResumeFile('candidate-uuid', 'other-tenant')).rejects.toMatchObject({ status: 404 });
  });
  it('reports a missing original resume without manufacturing a file', async () => {
    const service = new CandidatesService({ candidate: { findFirst: jest.fn().mockResolvedValue({ resumeRecord: { fileData: null } }) } } as any);
    await expect(service.getResumeFile('candidate-uuid', 'tenant-uuid')).rejects.toMatchObject({ status: 404 });
  });
});
