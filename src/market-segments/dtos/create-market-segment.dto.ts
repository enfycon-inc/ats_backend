export class CreateMarketSegmentDto {
  name: string;
  code: string;
  description?: string;
  defaultCurrency?: string;
  defaultTimezone?: string;
  defaultShift?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  isActive?: boolean;
  sortOrder?: number;
}
