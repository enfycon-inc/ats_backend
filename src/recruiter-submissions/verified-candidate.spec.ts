import { verifiedCandidateInput } from './verified-candidate';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';
const details = { firstName: 'Ana', lastName: 'Sen', email: 'ana@example.com', phone: '+919000012345', totalExperienceYears: '5', relevantExperienceYears: '4', currentCompany: 'Example', currentLocation: 'Kolkata', preferredLocations: 'Pune', noticePeriodDays: '0', availabilityToStart: '', skills: ['Python', 'AWS', 'Python'] };
it('normalizes verified skills without requiring profile edits', () => expect(verifiedCandidateInput(details, false, [])?.skills).toEqual(['Python', 'AWS']));
it('rejects invalid verified payloads and unauthorized profile updates', () => {
  expect(() => verifiedCandidateInput(details, true, ['submission:create'])).toThrow('edit permission');
  expect(() => verifiedCandidateInput({ ...details, skills: [] }, false)).toThrow('skills');
  expect(() => verifiedCandidateInput(details, 'true')).toThrow('option');
  expect(() => verifiedCandidateInput(undefined, true, ['candidate:edit'])).toThrow('required');
});
it.each([[false, false], [true, false], [false, true]])('stores verified details atomically, consent=%s duplicate=%s', async (update, duplicate) => {
  const tx: any = { $executeRawUnsafe: jest.fn(), candidate: { update: jest.fn() }, recruiterSubmission: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(({ data }) => ({ id: 'submission', ...data })) }, job: { update: jest.fn() }, submissionEvent: { create: jest.fn() } };
  const db: any = { job: { findFirst: jest.fn().mockResolvedValue({ id: 'job', status: 'ACTIVE', jobType: 'Full Time' }) }, jobRecruiter: { findUnique: jest.fn().mockResolvedValue({ jobId: 'job' }) }, user: { findFirst: jest.fn().mockResolvedValueOnce({ branchId: 'branch', businessUnitId: 'unit' }).mockResolvedValue(null) }, candidate: { findFirst: jest.fn().mockResolvedValue({ id: 'candidate' }) }, $transaction: jest.fn(fn => fn(tx)) };
  if (duplicate) tx.recruiterSubmission.findFirst.mockResolvedValue({ id: 'prior' });
  const request = new RecruiterSubmissionsService(db, {} as any).create({ jobId: 'job', candidateId: 'candidate', recruiterId: 'recruiter', verifiedCandidate: details, updateCandidateSkills: update } as any, 'tenant', { dbId: 'recruiter', permissions: ['submission:create', 'candidate:edit'] } as any);
  if (duplicate) {
    await expect(request).rejects.toThrow('already been submitted');
    expect(tx.recruiterSubmission.create).not.toHaveBeenCalled();
    expect(tx.candidate.update).not.toHaveBeenCalled();
    return;
  }
  await request;
  expect(tx.candidate.update).toHaveBeenCalledTimes(update ? 1 : 0);
  expect(tx.submissionEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ verifiedCandidate: expect.objectContaining({ skills: ['Python', 'AWS'] }), candidateSkillsUpdated: update }) }) }));
});
