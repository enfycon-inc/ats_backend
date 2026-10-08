import { assessCandidate } from './candidate-assessment';
describe('shared evidence assessment', () => {
  it('finds profile skills and résumé excerpts without substring false positives', () => {
    const result = assessCandidate({ skillsRequired: ['Java', 'Go', 'Python'] }, { skills: ['Python'], rawText: 'Built JavaScript services. Django projects.' });
    expect(result.criteria.map(row => row.finding)).toEqual(['NO_EVIDENCE', 'NO_EVIDENCE', 'EVIDENCE_FOUND']);
    expect(result.score).toBe(33);
  });
  it('captures résumé evidence and deduplicates requirements', () => {
    const result = assessCandidate({ skillsRequired: ['Python', 'python'] }, { rawText: 'Built APIs using Python and PostgreSQL.' });
    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0].evidence).toContain('Built APIs using Python');
    expect(result.score).toBe(100);
  });
  it('never invents full experience or budget credit from missing data', () => {
    const result = assessCandidate({ expMin: 3 }, {});
    expect(result.score).toBeNull(); expect(result.coverage).toBe(0);
    expect(result.criteria[0].finding).toBe('NEEDS_CLARIFICATION');
    expect(result.breakdown.map(row => row.label)).not.toContain('Salary');
  });
  it('does not match every nonempty candidate location against an empty job location', () => {
    const result = assessCandidate({ workMode: 'Hybrid' }, { rawCurrentLocation: 'Delhi' });
    expect(result.score).toBeNull(); expect(result.criteria[0].finding).toBe('NEEDS_CLARIFICATION');
  });
  it('matches the actual city and remote work mode', () => {
    expect(assessCandidate({ city: 'Pune', workMode: 'Hybrid' }, { rawCurrentLocation: 'Pune, India' }).score).toBe(100);
    expect(assessCandidate({ workMode: 'Remote' }, {}).criteria[0].finding).toBe('EVIDENCE_FOUND');
    expect(assessCandidate({ city: 'Pune', workMode: 'Hybrid' }, { rawCurrentLocation: 'Delhi' }).score).toBeNull();
  });
  it('preserves immediate notice and distinguishes known numeric failures from unknowns', () => {
    expect(assessCandidate({ noticePeriod: 'Immediate' }, { noticePeriodDays: 0 }).score).toBe(100);
    expect(assessCandidate({ noticePeriod: '15 days' }, { noticePeriodDays: 30 }).criteria[0].finding).toBe('DOES_NOT_MEET');
    expect(assessCandidate({ noticePeriod: '15/30/60 days' }, { noticePeriodDays: 30 }).criteria[0].finding).toBe('NEEDS_CLARIFICATION');
  });
  it('reports partial coverage instead of silently giving credit to unknown criteria', () => {
    const result = assessCandidate({ skillsRequired: ['Python'], expMin: 3, city: 'Pune' }, { skills: ['Python'] });
    expect(result.score).toBe(100); expect(result.coverage).toBe(60);
  });
  it('handles malformed parsed data and changes version when evidence changes', () => {
    const first = assessCandidate({ skillsRequired: ['Python'] }, { parsedJson: '{broken' });
    expect(first.score).toBeNull();
    expect(assessCandidate({ skillsRequired: ['Python'] }, { parsedJson: { skills: ['Python', 12] } }).score).toBe(100);
    expect(assessCandidate({ skillsRequired: ['Python'] }, { skills: ['Python'] }).version).not.toBe(first.version);
    expect(assessCandidate({ skillsRequired: ['Python'] }, { parsedJson: '{broken' }).version).toBe(first.version);
  });
});
