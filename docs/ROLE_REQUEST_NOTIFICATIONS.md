# Role request notifications

## Behavior

`POST /api/auth/request-role` validates the pending member's workspace, office,
unit, and requested role. A transaction locks the member record, saves a request
version, and inserts deduplicated email/in-app delivery jobs. An identical pending
submission keeps its version; a changed request gets a new version.

Recipients are active, approved members of the same workspace with an assigned
role capable of reviewing and granting the request. Each role is evaluated
independently, including office scope and the existing administrative assignment
policy. Permissions from different roles are never combined. The requester is
excluded. If nobody qualifies, the request is saved and the submission response
contains `notification.status = no_reviewers`; onboarding shows a warning.

The worker checks every 15 seconds and claims up to eight jobs using PostgreSQL
`FOR UPDATE SKIP LOCKED`, with a five-minute lease. It verifies the request version
and recipient's current eligibility again before sending. Email uses the existing
tenant-configured `SystemMailService`; in-app messages use `NotificationsService`
and a stable notification ID. No campaign mailbox or Redis queue is required for
this worker.

The existing WebSocket presence transport is not trusted for access-request
details. It carries only an empty `notifications_changed` signal; the client
refreshes its own notifications through the authenticated API. Request details
are not emitted to the presence channel or its admin stream.

Email buttons open `/auth/role-request` with a request ID/version and an eligible
assigned role ID. These values are identifiers, not bearer credentials. The JWT
guard independently verifies the assigned role. Authentication returns to the
same review screen for password, Google, and Microsoft login. The screen fetches
the exact request, independently of the Users list, and requires confirmation.
GET requests never change access. Decisions compare the saved version, pending
state, tenant, and original office atomically; only one competing decision wins.

## Deployment

1. Follow `prisma/PRODUCTION-MIGRATIONS.md`. Apply the additive migration
   `20261021030000_role_request_notifications` through the normal reviewed
   deployment process before starting the new backend.
2. Deploy the backend and frontend changes together. Older frontend clients do
   not send versions and cannot decide newly versioned requests; refresh those
   clients after deployment.
3. Verify a new request with controlled test accounts in staging, including a
   reviewer whose eligible role is an additional assignment. Check the configured
   workspace sender, provider acceptance, and actual inbox arrival separately.
4. Existing pending requests are not automatically emailed by the migration.
   A new submission through onboarding creates their version and delivery jobs.

This change does not configure senders, change production settings, apply database
migrations, or send test messages to real reviewers during development.

## Delivery operations

Statuses: `pending`, `sending`, `accepted`, `cancelled`, `failed`. A completed or
replaced request, or a reviewer who lost eligibility, cancels queued work.
Provider failures retry up to five attempts, normally after 2, 4, 8, and 16 minutes.
Worker crashes release work when its lease expires. Failures are logged with the
delivery ID/channel/attempt, without message content or provider credentials.

`accepted` means the provider accepted the message; it does not prove inbox
delivery. Delivery is at least once: a provider acceptance followed by a lost
response or process crash can produce a repeated email. In-app records use one
stable ID, and request decisions remain protected against repeated actions.

Operators can inspect failed delivery counts without exposing message content:

```sql
SELECT channel, status, count(*)
FROM ats.role_request_deliveries
WHERE tenant_id = $1::uuid
GROUP BY channel, status;
```

After correcting sender/provider configuration, an authorized operator may retry
one identified failed delivery by resetting its status to `pending`, attempts to
zero, `available_at` to `NOW()`, and lease to null. Constrain the operation by the
delivery ID, tenant ID, and `status = 'failed'`. The worker rechecks eligibility.
No automatic replay of all historical requests is performed.

## Contracts and verification

`src/auth/role-request-contract.ts` is canonical. From the sibling frontend repo,
run `node scripts/sync-role-request-contract.cjs` to regenerate its contract, or
add `--check` to detect drift. The frontend regression tests compare the generated
copy when both repositories are present; standalone images use the generated
type-only file and do not import backend runtime code.

Backend regression suites cover request routing, recipient selection, stale and
competing decisions, retry/cancellation behavior, tenant email dispatch, escaping,
and safe action URLs. Frontend tests cover login return paths and the explicit
confirmation requirement for both email actions.

## Rollback

Restore the previous backend/frontend application release through the normal
rollback process. The old backend does not run the worker. Leave the additive
column and delivery table intact, preserving requests and delivery evidence; do
not drop data as part of application rollback.
