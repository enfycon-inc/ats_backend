import { currentTrackerRound, trackerBucketConditions } from './tracker-workflow';

describe('tracker workflow', () => {
  it.each([
    [{}, 'l1'],
    [{ l1_status: 'SCHEDULED' }, 'l1'],
    [{ l1Status: 'CLEARED' }, 'l2'],
    [{ l1_status: 'CLEARED', l2_status: 'CLEARED' }, 'l3'],
    [{ l1Status: 'CLEARED', l2Status: 'REJECTED' }, 'l2'],
    [{ l1_status: 'CLEARED', l2_status: 'CLEARED', l3_status: 'CLEARED' }, null],
  ])('selects the eligible round for %j', (row, expected) => {
    expect(currentTrackerRound(row)).toBe(expected);
  });
  it('uses qualified predicates for rows and matching unqualified predicates for counts', () => {
    const count = trackerBucketConditions();
    const rows = trackerBucketConditions('s.');
    for (const bucket of Object.keys(count)) {
      expect(rows[bucket].replace(/s\./g, '')).toBe(count[bucket]);
    }
    expect(count.review).toContain('NOT (');
    expect(count.interviews).toContain('l3_date IS NOT NULL');
  });
});
