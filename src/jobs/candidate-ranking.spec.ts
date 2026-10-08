import { JobsService } from './jobs.service';
import { assessCandidate } from './candidate-assessment';
describe('ranking assessment reuse', () => {
  it('uses the shared engine, tenant filters and no unscoped semantic request', async () => {
    const job = { skillsRequired: ['Python', 'AWS'], secondarySkills: [], expMin: 3, city: 'Pune', workMode: 'Hybrid', jobCode: 'test' };
    const row = { id: 'candidate-id', full_name: 'Test candidate', skills: ['Python'], total_experience_years: 4, raw_current_location: 'Delhi', raw_text: 'Python developer' };
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([row]) };
    const service = new JobsService(prisma as any, {} as any);
    jest.spyOn(service, 'findOneJob').mockResolvedValue(job as any);
    const network = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Must not query unscoped search'));
    try {
      const result = await service.findMatchingCandidates('job-id', 'tenant-id');
      const expected = assessCandidate(job, { skills: row.skills, totalExperienceYears: 4, rawCurrentLocation: 'Delhi', rawText: row.raw_text });
      expect(result.matches[0].assessment?.score).toBe(expected.score);
      expect(result.matches[0].assessment?.coverage).toBe(expected.coverage);
      expect(result.parserOnline).toBe(false); expect(network).not.toHaveBeenCalled();
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('c.tenant_id = $1');
      expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe('tenant-id');
    } finally { network.mockRestore(); }
  });
});
