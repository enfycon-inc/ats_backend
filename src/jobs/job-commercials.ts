import { BadRequestException } from '@nestjs/common';

export function positiveInteger(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)) {
    throw new BadRequestException(`${label} must be a whole number of at least 1.`);
  }
}

export function parseCommercialRate(value: unknown) {
  if (value == null || value === '' || value === 'N/A') return { min: null, max: null, currency: null, term: null, commission: null };
  const text = String(value).replace(/,/g, '').trim().replace(/^(INR|USD)\s*-\s*/i, '$1 ');
  const commission = /%\s*Placement Commission/i.test(text);
  const valid = commission
    ? /^\d+(?:\.\d+)?%\s*Placement Commission$/i.test(text)
    : /^(?:(?:INR|USD)\s*)?\$?\d+(?:\.\d+)?(?:\s+to\s+\$?\d+(?:\.\d+)?)?(?:\s*(?:LPA|\/mo|Monthly|\/hr|Hourly|\/yr|Yearly))?$/i.test(text);
  const numbers = text.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!valid || !numbers.length || /-\s*\d/.test(text) || numbers.some(n => !Number.isFinite(n))) {
    throw new BadRequestException('Enter a valid non-negative rate.');
  }
  const [min, max = min] = numbers;
  if (max < min || numbers.length > 2) throw new BadRequestException('Maximum budget must be at least the minimum budget.');
  if (commission && (min > 100 || numbers.length !== 1)) throw new BadRequestException('Commission must be between 0 and 100.');
  return {
    min: commission ? null : min, max: commission ? null : max,
    commission: commission ? min : null,
    currency: /USD|\$/i.test(text) ? 'USD' : /INR|₹/i.test(text) ? 'INR' : null,
    term: /LPA/i.test(text) ? 'LPA' : /\/mo|Monthly/i.test(text) ? 'Monthly' : /\/yr|Yearly/i.test(text) ? 'Yearly' : /\/hr|Hourly/i.test(text) ? 'Hourly' : null,
  };
}

export function commercialFields(dto: { clientBillRate?: unknown; payRate?: unknown }, india: boolean) {
  const result: Record<string, any> = {};
  for (const [input, prefix] of [['clientBillRate', 'clientBillRate'], ['payRate', 'payRate']] as const) {
    if (dto[input] === undefined) continue;
    const rate = parseCommercialRate(dto[input]);
    if (india && rate.currency === 'USD') throw new BadRequestException('India staffing rates must use INR.');
    result[`${prefix}Min`] = rate.min;
    result[`${prefix}Max`] = rate.max;
    result[prefix === 'payRate' ? 'payCurrency' : 'clientBillCurrency'] = india ? 'INR' : rate.currency;
    result[prefix === 'payRate' ? 'payTerm' : 'clientBillTerm'] = rate.term;
    if (input === 'clientBillRate') result.placementCommissionPct = rate.commission;
  }
  return result;
}

export function displayCommercialRate(row: any, prefix: 'pay' | 'clientBill'): string {
  const field = (snake: string, camel: string) => row[snake] ?? row[camel];
  if (prefix === 'clientBill') {
    const commission = field('placement_commission_pct', 'placementCommissionPct');
    if (commission != null) return `${Number(commission)}% Placement Commission`;
  }
  const snake = prefix === 'pay' ? 'pay' : 'client_bill';
  const ratePrefix = prefix === 'pay' ? 'payRate' : 'clientBillRate';
  const min = field(`${snake}_rate_min`, `${ratePrefix}Min`);
  const max = field(`${snake}_rate_max`, `${ratePrefix}Max`);
  if (min == null) return 'N/A';
  const currency = field(`${snake}_currency`, `${prefix}Currency`) || '';
  const term = field(`${snake}_term`, `${prefix}Term`) || '';
  const suffix = ({ Monthly: '/mo', Hourly: '/hr', Yearly: '/yr' } as Record<string, string>)[term] || term;
  return `${currency} - ${Number(min)}${max != null && Number(max) !== Number(min) ? ` to ${Number(max)}` : ''} ${suffix}`.trim();
}

export function displayClientBillRate(row: any, permissions: string[] = []): string {
  const canViewRate = permissions.some(permission => ['*', 'platform:manage', 'job:bill_rate:view'].includes(permission));
  const canViewCommission = permissions.some(permission => ['*', 'platform:manage', 'placement:view'].includes(permission));
  const raw = row.client_bill_rate ?? row.clientBillRate;
  const rawText = typeof raw === 'string' ? raw.trim() : '';
  const rawCommission = rawText.match(/^(\d+(?:\.\d+)?)%\s*Placement Commission$/i);
  const commission = row.placement_commission_pct ?? row.placementCommissionPct ?? rawCommission?.[1];
  const hasNumericRate = row.client_bill_rate_min != null || row.clientBillRateMin != null;

  if (canViewRate && hasNumericRate) {
    return displayCommercialRate({ ...row, placement_commission_pct: null, placementCommissionPct: null, client_bill_rate: null, clientBillRate: null }, 'clientBill');
  }
  if (commission != null || rawCommission) {
    if (!canViewCommission) return 'N/A';
    return `${Number(commission)}% Placement Commission`;
  }
  if (!canViewRate) return 'N/A';
  if (rawText && rawText.toUpperCase() !== 'N/A') return rawText;
  return displayCommercialRate(row, 'clientBill');
}
