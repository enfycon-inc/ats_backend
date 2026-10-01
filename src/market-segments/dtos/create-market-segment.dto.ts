export class CreateMarketSegmentDto {
  name: string;
  code: string;
  description?: string;
  defaultCurrency?: string;
          isActive?: boolean;
  sortOrder?: number;
}
