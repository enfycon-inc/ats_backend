export const SUBMISSION_AUTO_APPROVAL_PERMISSION = 'submission:auto_approve_internal_review' as const;

// Role archetypes configure defaults only. Request authorization checks permissions.
export const SUBMISSION_AUTO_APPROVAL_DEFAULT_ROLES = [
  'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'BRANCH_ADMIN', 'UNIT_ADMIN', 'TENANT_ADMIN',
] as const;

export function submissionAutoApprovalDefaults(systemKey: string): string[] {
  return (SUBMISSION_AUTO_APPROVAL_DEFAULT_ROLES as readonly string[]).includes(systemKey)
    ? [SUBMISSION_AUTO_APPROVAL_PERMISSION] : [];
}

export type SubmissionAutoApprovalAudit = {
  mode: 'AUTO_PERMISSION';
  permission: typeof SUBMISSION_AUTO_APPROVAL_PERMISSION;
  activeRoleId: string | null;
  activeRoleName: string | null;
};

export function submissionCreationReview(actor?: {
  dbId?: string; permissions?: string[]; activeRoleId?: string | null; roleName?: string;
}): { finalStatus: 'SUBMITTED' | 'PENDING_APPROVAL'; automaticInternalReview?: SubmissionAutoApprovalAudit } {
  const allowed = Boolean(actor?.dbId && actor.permissions?.some(permission =>
    permission === SUBMISSION_AUTO_APPROVAL_PERMISSION || permission === '*'));
  return allowed ? {
    finalStatus: 'SUBMITTED',
    automaticInternalReview: {
      mode: 'AUTO_PERMISSION', permission: SUBMISSION_AUTO_APPROVAL_PERMISSION,
      activeRoleId: actor?.activeRoleId || null, activeRoleName: actor?.roleName || null,
    },
  } : { finalStatus: 'PENDING_APPROVAL' };
}
