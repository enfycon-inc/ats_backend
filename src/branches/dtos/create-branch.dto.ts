export class CreateBranchDto {
  name: string;
  code?: string;
  city?: string;
  state?: string;
  country?: string;
  market?: string;
  timezone?: string;
  workStartTime?: string;
  workEndTime?: string;
  workingDays?: string[];
  shiftTiming?: string;
  breakDurationMinutes?: number;
}
