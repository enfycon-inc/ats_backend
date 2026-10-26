# Submission auto-approval

`submission:auto_approve_internal_review` is an independent granular permission.
When an authorized user creates a candidate submission using a role with this
permission, the backend saves `finalStatus = SUBMITTED` and `l1Status = PENDING`.
Otherwise it saves `PENDING_APPROVAL`. A legacy client status hint cannot bypass
this decision. Manual screening permission alone does not enable auto-approval.

The JWT guard resolves the exact active assigned role on each request. An account
with both Account Manager and Recruiter roles does not borrow Account Manager
auto-approval when submitting as Recruiter. Changing roles does not update
existing submissions. Existing self-review restrictions on manual decisions stay
in effect. This permission applies only to new submissions.

All existing submission-create, tenant, branch, unit, assignment, and active-job
checks still apply. The submitter must use their own recruiter identity. The
creation transaction also protects against duplicate tenant/job/candidate
submissions before writing history or incrementing the job submission count.

## Role defaults

Default on: Account Manager, Delivery Head, Branch Admin, Unit Admin, Tenant Admin.
Recruiter and Pod Lead do not receive this default. Role names configure bundles;
request authorization checks only the permission. Administrators can remove it.

The versioned `submission-auto-approval-v1` configuration runs through the existing
`applyJobActionPermissions` release/bootstrap entry point. It updates system
templates and existing custom/derived bundles for these archetypes once, using
tenant-matched ancestry, transaction locks, and audit receipts. Subsequent
permission removals are preserved. Future default roles inherit the new default;
explicit custom permission selections remain authoritative.

No schema migration is needed. Existing submission-event JSON records the
automatic approval reason, permission, active role ID, and role name together with
the creation snapshot. The timeline identifies automatic approval separately from
manual review. Backend/front-end shared metadata is checked by the contract sync.

## Rollback

Revert application images if necessary. Existing approved submissions remain
approved and their audit metadata is retained. Older application versions ignore
the new permission and metadata. To disable new automatic approvals without a
code rollback, remove the permission from the applicable role bundles. Do not
rewrite historical submission statuses or remove audit receipts.
