import { BadRequestException } from '@nestjs/common';
export function isContractJob(type?: string | null) { return /^(contract|contractual|contract to hire|contract-to-hire|c2h|freelance)$/i.test((type || '').trim()); }
export function submissionCompensation(dto: any, jobType?: string | null) {
  if (dto.compensationInputUnit === undefined) {
    if (dto.currentCompensation !== undefined || dto.expectedCompensation !== undefined || dto.compensationCurrency !== undefined) throw new BadRequestException('Compensation unit is required.');
    return {};
  }
  const contract = isContractJob(jobType);
  const unit = dto.compensationInputUnit;
  if (!['LPA', 'MONTH', 'YEAR'].includes(unit) || (contract && unit !== 'MONTH') || (!contract && unit === 'MONTH')) throw new BadRequestException('Compensation unit does not match the saved job type.');
  if (!['INR', 'USD', 'CAD', 'GBP', 'EUR'].includes(dto.compensationCurrency) || (unit === 'LPA' && dto.compensationCurrency !== 'INR')) throw new BadRequestException('Select a valid compensation currency.');
  const normalize = (value: unknown, optional: boolean, positive = false) => {
    if ((value === '' || value == null) && optional) return null;
    const text = String(value ?? '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new BadRequestException('Enter a valid compensation amount with at most two decimal places.');
    const [whole, fraction = ''] = text.split('.');
    const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (unit === 'LPA' ? 100000n : 1n);
    if (cents > 999999999999n || (positive && cents <= 0n)) throw new BadRequestException('Compensation amount is outside the supported range.');
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  };
  return { currentCompensationAmount: normalize(dto.currentCompensation, contract), expectedCompensationAmount: normalize(dto.expectedCompensation, false, true), compensationCurrency: dto.compensationCurrency, compensationPeriod: contract ? 'MONTH' : 'YEAR', compensationInputUnit: unit };
}
export function submissionSource(dto: any) {
  if (dto.sourceCategory === undefined) return {};
  if (!['Bench', 'Market'].includes(dto.sourceCategory)) throw new BadRequestException('Select Bench or Market.');
  if (dto.sourceCategory === 'Bench') return { sourceCategory: 'Bench', sourceChannel: null, sourceDetail: null };
  if (!['LinkedIn', 'Job Portal', 'Employee Referral', 'Recruitment Agency / Vendor', 'Direct Application', 'Existing Talent Pool', 'Other'].includes(dto.sourceChannel)) throw new BadRequestException('Select a source channel.');
  const detail = typeof dto.sourceDetail === 'string' ? dto.sourceDetail.trim() : '';
  if (detail.length > 255 || (['Job Portal', 'Other'].includes(dto.sourceChannel) && !detail)) throw new BadRequestException('Enter the portal name or source details.');
  return { sourceCategory: 'Market', sourceChannel: dto.sourceChannel, sourceDetail: detail || null };
}
