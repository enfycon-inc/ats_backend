export class UpdateBranchDto {
  name?: string;
  code?: string;
  city?: string;
  state?: string;
  country?: string;
  market?: string;
  isActive?: boolean;
  allowNone?: boolean;
  allowPods?: boolean;
  allowAll?: boolean;
  allowUnassigned?: boolean;
  podDistributionStrategy?: 'AUTO' | 'MANUAL';
  requireAmJobApproval?: boolean;
  requireJobApproval?: boolean;
  rolesRequiringApproval?: string[];
  defaultJobApproverRole?: string;
  allowedJobApproverRoles?: string[];
  approvalRoutingMode?: 'FLEXIBLE' | 'ENFORCE_DEFAULT';
  timezone?: string;
  workStartTime?: string;
  workEndTime?: string;
  workingDays?: string[];
  shiftTiming?: string;
  breakDurationMinutes?: number;
  enableGlobalRemarks?: boolean;
}
