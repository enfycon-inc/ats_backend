import { recruitmentActivity } from './recruitment-activity';

describe('visible recruitment activity', () => {
  it('does not claim a global absence of submissions', () => expect(recruitmentActivity([])).toBe('No visible submissions'));
  it('keeps closed outcomes at submission level', () => expect(recruitmentActivity([{ submissionCount: 2 }])).toBe('No active submissions'));
  it('shows a confirmed joining', () => expect(recruitmentActivity([{ submissionCount: 1, joinedCount: 1 }])).toBe('Joined'));
  it('combines active and pending counts without letting a prior join hide them', () => {
    expect(recruitmentActivity([{ submissionCount: 3, activeCount: 2, joinedCount: 1 }, { submissionCount: 1, pendingCount: 1 }])).toBe('In progress · 2 / Awaiting screening · 1');
  });
});
