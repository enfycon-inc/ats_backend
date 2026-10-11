import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import { submissionCompensation, submissionSource, isContractJob } from './submission-compensation';
describe('recruiter compensation and sourcing', () => {
 const full = { currentCompensation: '12', expectedCompensation: '15.25', compensationCurrency: 'INR', compensationInputUnit: 'LPA' };
 it('normalizes LPA on the backend using exact decimal arithmetic', () => expect(submissionCompensation(full, 'Full Time')).toMatchObject({ currentCompensationAmount: '1200000.00', expectedCompensationAmount: '1525000.00', compensationPeriod: 'YEAR' }));
 it('preserves monthly pay without converting it to CTC', () => expect(submissionCompensation({ ...full, currentCompensation: '', expectedCompensation: '60000.50', compensationInputUnit: 'MONTH' }, 'Contract')).toMatchObject({ currentCompensationAmount: null, expectedCompensationAmount: '60000.50', compensationPeriod: 'MONTH' }));
 it.each(['Contract', 'Contractual', 'C2H', 'Freelance'])('routes %s as contractual', type => expect(isContractJob(type)).toBe(true));
 it('rejects mismatched units and currencies', () => { expect(() => submissionCompensation(full, 'Contract')).toThrow('unit'); expect(() => submissionCompensation({ ...full, compensationCurrency: 'USD' }, 'Full Time')).toThrow('currency'); });
 it.each(['-1', 'NaN', '12abc', '1.234', '0', '100000000000'])('rejects invalid expected compensation %s', value => expect(() => submissionCompensation({ ...full, expectedCompensation: value }, 'Full Time')).toThrow());
 it('keeps legacy requests unchanged', () => expect(submissionCompensation({}, 'Full Time')).toEqual({}));
 it('clears stale Market details when Bench is selected', () => expect(submissionSource({ sourceCategory: 'Bench', sourceChannel: 'LinkedIn' })).toEqual({ sourceCategory: 'Bench', sourceChannel: null, sourceDetail: null }));
 it('requires channel details only where appropriate', () => { expect(submissionSource({ sourceCategory: 'Market', sourceChannel: 'LinkedIn' })).toMatchObject({ sourceChannel: 'LinkedIn' }); expect(() => submissionSource({ sourceCategory: 'Market', sourceChannel: 'Job Portal' })).toThrow('details'); expect(() => submissionSource({ sourceCategory: 'Market', sourceChannel: 'fake' })).toThrow('channel'); });
});

describe('submission compensation persistence', () => {
 it.each([['Contract', 'MONTH', '60000', '60000.00', 'MONTH'], ['Full Time', 'LPA', '12', '1200000.00', 'YEAR']])('stores and returns normalized %s compensation without writing legacy CTC', async (jobType, unit, entered, stored, period) => {
  const tx: any = { recruiterSubmission: { create: jest.fn(({ data }) => ({ ...data, id: 'submission' })) }, job: { update: jest.fn() }, submissionEvent: { create: jest.fn() } };
  const prisma: any = { job: { findFirst: jest.fn().mockResolvedValue({ id: 'job', jobType, status: 'ACTIVE' }) }, candidate: { findFirst: jest.fn().mockResolvedValue({ id: 'candidate', fullName: 'Name', currentCtc: '7', expectedCtc: '9' }) }, user: { findFirst: jest.fn().mockResolvedValue(null) }, $transaction: jest.fn(fn => fn(tx)) };
  const result = await new RecruiterSubmissionsService(prisma, {} as any).create({ jobId: 'job', candidateId: 'candidate', recruiterId: 'recruiter', currentCompensation: jobType === 'Full Time' ? '0' : '', expectedCompensation: entered, compensationCurrency: 'INR', compensationInputUnit: unit, sourceCategory: 'Market', sourceChannel: 'LinkedIn', availabilityToStart: 'Immediate' } as any, 'tenant');
  if (jobType === 'Full Time') expect(result.currentCompensationAmount).toBe('0.00');
  expect(result).toMatchObject({ expectedCompensationAmount: stored, compensationPeriod: period, sourceCategory: 'Market', sourceChannel: 'LinkedIn', availabilityToStart: 'Immediate' });
  expect(tx.recruiterSubmission.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ candidateCurrentCtc: null, candidateExpectedCtc: null, expectedCompensationAmount: stored }) }));
  expect(tx.submissionEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: { snapshot: expect.objectContaining({ expectedCompensationAmount: stored, sourceChannel: 'LinkedIn' }) } }) }));
 });
});
