import { CandidatesService } from './candidates.service';

describe('candidate upload recruiter overrides', () => {
  function setup() {
    const candidate = { update: jest.fn().mockResolvedValue({ id: 'candidate', fullName: 'Recruiter Name' }), findFirst: jest.fn().mockResolvedValue({ id: 'candidate' }) };
    const prisma: any = { candidate, resume: { create: jest.fn().mockResolvedValue({ id: 'resume' }) } };
    const service = new CandidatesService(prisma);
    jest.spyOn(service as any, 'findByHash').mockResolvedValue({ id: 'candidate', fullName: 'Recruiter Name', email: 'a@example.com', parsedJson: { candidate_name: 'Parser Name', location: 'Wrong location' } });
    jest.spyOn(service as any, 'mapCandidateToProfile').mockImplementation((row: any) => row);
    return { service, candidate };
  }
  const file = { originalname: 'cv.pdf', mimetype: 'application/pdf', buffer: Buffer.from('test') };
  it('applies edits to duplicate uploads and persists immediate notice and separate names', async () => {
    const { service, candidate } = setup();
    await service.saveUploadedCv(file, 'tenant', { fullName: 'Recruiter Name', email: 'a@example.com', firstName: 'Recruiter', lastName: 'Name', location: 'Kolkata, West Bengal', noticePeriodDays: '0' });
    expect(candidate.update.mock.calls[0][0].data).toMatchObject({ firstName: 'Recruiter', lastName: 'Name', rawCurrentLocation: 'Kolkata, West Bengal', noticePeriodDays: 0 });
  });
  it('rejects invalid mobile lengths before persistence', async () => {
    const { service, candidate } = setup();
    await expect(service.saveUploadedCv(file, 'tenant', { phone: '+9196920040666' })).rejects.toThrow('Invalid mobile');
    expect(candidate.update).not.toHaveBeenCalled();
  });
});
