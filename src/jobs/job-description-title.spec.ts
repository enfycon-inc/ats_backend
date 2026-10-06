import { JobsService } from './jobs.service';

describe('JD title parsing', () => {
  let service: JobsService;

  beforeEach(() => {
    service = new JobsService({} as any, {} as any);
    jest.spyOn(service as any, 'getDbSkillDictionary').mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])('leaves an unidentified title blank when parser success is %s', async success => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: success,
      json: async () => ({ success: true, jobTitle: 'Unknown' }),
    } as Response);
    const result = await service.parseJobDescription('Required Skills: Python, SQL\nExperience: 2-5 years');
    expect(result.jobTitle).toBe('');
    expect(result.primarySkills).toContain('Python');
  });

  it.each(['Job Title: Data Scientist', '# Senior Python Developer'])('preserves a title extracted from %s', async text => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);
    const result = await service.parseJobDescription(text);
    expect(result.jobTitle).toBe(text.replace('Job Title: ', '').replace('# ', ''));
  });

  it('preserves a title identified by the parser', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, jobTitle: 'Registered Nurse' }),
    } as Response);
    expect((await service.parseJobDescription('Patient care responsibilities')).jobTitle).toBe('Registered Nurse');
  });
});
