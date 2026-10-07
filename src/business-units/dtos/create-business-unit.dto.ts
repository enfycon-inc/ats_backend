export class CreateBusinessUnitDto {
  name: string;
  branchId?: string;
  code?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  market?: string;
  currency?: string;
  shiftTiming?: string;
  workStartTime?: string;
  workEndTime?: string;
  timezone?: string;
  workingDays?: string[];
  breakDurationMinutes?: number;
  allowNone?: boolean;
  allowPods?: boolean;
  allowUnassigned?: boolean;
  podDistributionStrategy?: string;
}

