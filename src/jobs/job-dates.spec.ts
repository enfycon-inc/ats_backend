import { validateJobDates } from './job-dates';
describe('expected job dates', () => {
 it.each([[undefined, undefined], ['2026-11-01', undefined], [undefined, '2027-01-01'], ['2026-11-01', '2026-11-01'], ['2026-11-01', '2027-01-01']])('allows incomplete or ordered dates %s %s', (start, end) => expect(() => validateJobDates(start, end)).not.toThrow());
 it('rejects reversed dates', () => expect(() => validateJobDates('2026-11-02', '2026-11-01')).toThrow('on or after'));
 it.each(['2026-02-30', 'bad-date'])('rejects invalid dates %s', date => expect(() => validateJobDates(date)).toThrow('valid'));
});
