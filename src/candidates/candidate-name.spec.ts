import { resolveCandidateName } from './candidate-name';

describe('candidate name resolution', () => {
  it('uses the existing split convention for a reliable full name', () => {
    expect(resolveCandidateName({}, null, '  Sruti   Swagatika Sarangi ')).toEqual({ firstName: 'Sruti', lastName: 'Swagatika Sarangi' });
  });
  it('preserves recruiter names before structured parser values', () => {
    expect(resolveCandidateName({ firstName: 'Sruti Swagatika', lastName: 'Sarangi' }, { firstName: 'Wrong', lastName: 'Name' }, 'Wrong Name')).toEqual({ firstName: 'Sruti Swagatika', lastName: 'Sarangi' });
  });
  it('prefers structured parser parts over splitting', () => {
    expect(resolveCandidateName({}, { first_name: 'Sruti Swagatika', last_name: 'Sarangi' }, 'Sruti Swagatika Sarangi')).toEqual({ firstName: 'Sruti Swagatika', lastName: 'Sarangi' });
  });
  it('does not invent a surname for a single name or resolve placeholders', () => {
    expect(resolveCandidateName({}, null, 'Madonna')).toEqual({ firstName: 'Madonna', lastName: undefined });
    expect(resolveCandidateName({}, null, 'Unnamed Candidate')).toEqual({ firstName: undefined, lastName: undefined });
  });
});
