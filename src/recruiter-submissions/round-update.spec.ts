import { roundUpdate } from './round-update';
import { historyChanges } from './submission-history';

describe('audited round correction projection', () => {
  it('resets affected appointments and feedback while capturing the original values', () => {
    const existing = { l1Status: 'CLEARED', l2Status: 'CLEARED', l2Date: new Date('2026-10-09T05:30:00Z'), l2Remarks: 'Passed', l2Interviewer: 'Client', l3Status: 'SCHEDULED', l3Date: '2026-10-10T05:30:00Z' };
    const changes = roundUpdate(existing, { l1Status: 'PENDING', resetFollowingRounds: true, correctionReason: 'Incorrect L1 result' });
    expect(changes).toMatchObject({ l1Status: 'PENDING', l1Date: null, l2Status: 'PENDING', l2Date: null, l2Remarks: null, l2Interviewer: null, l3Status: 'PENDING', l3Date: null });
    const history = historyChanges(existing, changes);
    expect(history.l2Status).toEqual({ before: 'CLEARED', after: 'PENDING' });
    expect(history.l2Remarks).toEqual({ before: 'Passed', after: null });
    expect(history.l2Date.before).toBe('2026-10-09T05:30:00.000Z');
    expect(existing.l2Remarks).toBe('Passed');
  });
  it('does not erase appointments when rescheduling or cancelling', () => {
    const existing = { l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z' };
    expect(roundUpdate(existing, { l1Status: 'CANCELLED', l1Remarks: 'Client cancelled' })).not.toHaveProperty('l1Date');
  });
});
