import { BadRequestException } from '@nestjs/common';
export function validateJobDates(start?: string | Date | null, end?: string | Date | null) {
  const dates = [start, end].map(value => {
    if (!value) return null;
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException('Use a valid date in YYYY-MM-DD format.');
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new BadRequestException('Use a valid calendar date.');
    return text;
  });
  if (dates[0] && dates[1] && dates[1] < dates[0]) throw new BadRequestException('Expected End Date must be on or after Expected Start Date.');
}
