import { commercialFields, displayCommercialRate, parseCommercialRate, positiveInteger } from './job-commercials';

describe('job commercial values', () => {
  it('round trips both monthly budget bounds without comma truncation', () => {
    const fields = commercialFields({ payRate: 'INR - 50,000 to 1,50,000 /mo' }, true);
    expect(fields).toMatchObject({ payRateMin: 50000, payRateMax: 150000, payCurrency: 'INR', payTerm: 'Monthly' });
    expect(displayCommercialRate(fields, 'pay')).toBe('INR - 50000 to 150000 /mo');
  });
  it('keeps LPA decimals and commission separate from bill rates', () => {
    const fields = commercialFields({ payRate: 'INR - 10.5 to 15.25 LPA', clientBillRate: '8.33% Placement Commission' }, true);
    expect(fields).toMatchObject({ payRateMin: 10.5, payRateMax: 15.25, placementCommissionPct: 8.33, clientBillRateMin: null });
    expect(displayCommercialRate(fields, 'clientBill')).toBe('8.33% Placement Commission');
  });
  it('rejects USD in India while retaining US rates', () => {
    expect(() => commercialFields({ clientBillRate: 'USD - $100/hr' }, true)).toThrow('INR');
    expect(commercialFields({ clientBillRate: 'USD - $100/hr' }, false)).toMatchObject({ clientBillRateMin: 100, clientBillCurrency: 'USD', clientBillTerm: 'Hourly' });
  });
  it.each(['INR - -500 /mo', 'INR - 100 to 50 /mo', 'invalid', '101% Placement Commission'])(
    'rejects invalid rate %s', value => expect(() => parseCommercialRate(value)).toThrow(),
  );
  it('accepts empty draft rates without NaN values', () => {
    expect(parseCommercialRate('')).toMatchObject({ min: null, max: null });
    expect(displayCommercialRate({ pay_rate_min: null }, 'pay')).toBe('N/A');
  });
  it.each([0, -1, 1.5, NaN, Infinity, '1', null])('rejects invalid submission limit %s', value => {
    expect(() => positiveInteger(value, 'Maximum allowed submissions')).toThrow();
  });
  it('accepts positive integer limits and omitted defaults', () => {
    expect(() => positiveInteger(1, 'Submissions')).not.toThrow();
    expect(() => positiveInteger(undefined, 'Submissions')).not.toThrow();
  });
});
