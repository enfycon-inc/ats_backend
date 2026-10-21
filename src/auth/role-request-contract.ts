/** Canonical role-request API contracts. The web client generates its copy with scripts/sync-role-request-contract.cjs. */
export interface RoleRequestSubmission {
  success: true;
  message: string;
  requestVersion: string;
  notification: { status: 'queued' | 'no_reviewers'; recipientCount: number };
}

export interface RoleRequestDecision {
  expectedRequestVersion?: string;
  roleId?: string;
  roleIds?: string[];
  roles?: string[];
  branchId?: string | null;
  businessUnitId?: string | null;
}

export interface RoleRequestReview {
  id: string;
  fullName: string;
  email: string;
  requestedRole: string;
  roleId: string;
  branchId: string | null;
  businessUnitId: string | null;
  branchName: string | null;
  businessUnitName: string | null;
  requestVersion: string;
}
