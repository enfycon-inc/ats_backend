# User management rollout

This release implements route-based user management, scoped activity APIs, authenticated realtime connections, per-workspace session revocation, durable security notifications, provider-event ingestion, self-service sessions and optional office evidence. It does not deploy itself or backfill unknown historical logins.

## Before deployment

1. Back up the target database and test restoration. Review the additive migrations: `20261026150000_user_management_activity`, `20261026160000_office_location_evidence`, and `20261026170000_unit_geofences`.
2. Apply migrations once through the normal reviewed deployment job (`npm run db:migrate:deploy`) before starting new application images. Do not run `migrate dev`, reset, or `db push` against a shared/production database. Both migrations are required even with telemetry disabled because this release generates the updated Prisma client.
3. Generate the Prisma client as part of the backend image build. Build the frontend with `sync-user-management-contract.cjs --check` passing; the backend contract is the canonical source.
4. Configure `ALLOWED_ORIGINS` for actual frontend/custom domains. Configure `TRUSTED_PROXY_CIDRS` to the real ingress/proxy addresses, with network rules preventing direct untrusted ingress and with forwarded headers overwritten by the proxy. A blanket trusted range undermines IP evidence. Socket transport does not overwrite HTTP-observed IPs with its proxy address.
5. Verify Redis connectivity and message delivery between replicas. The existing BullMQ connection supplies presence and notification pub/sub; the gateway re-authenticates before delivery and on a 30-second timer.
6. Preserve existing account-management capabilities. Grant new capabilities explicitly to suitable custom roles through Roles & Permissions; adding the catalog entries does not grant them automatically.

## Suggested grants

| Audience | Explicit capabilities and required scope |
| --- | --- |
| Delivery Head | `user:presence:view`; assigned branch/unit. Add `user:view` only if directory access is intended. |
| Account administrator | Existing `user:manage`; current resource/protected-target rules remain in effect. |
| Tenant security administrator | `user:sessions:view`, `user:login_logs:view`, `user:session_ip:view`, `user:sessions:revoke`; tenant scope requires the existing tenant management capability. Export additionally requires `user:login_logs:export`. |
| Office policy administrator | `branch:network:manage`, with a permitted branch or tenant scope; activity page also requires a presence/session/history capability. |
| Unit geofence administrator | `unit:geofence:manage`, scoped to their unit, assigned branches, or tenant. This does not grant branch network or location history access. |
| Office evidence viewer | `user:location:view` plus scoped presence access. No raw IP permission is implied. |
| Employee | Self-session endpoints require only their authenticated membership, not user-management access. |

The active selected role controls permissions. Role names and `user:manage` alone do not grant security telemetry access. Users without a branch/unit are not silently given tenant-wide scope.

## Enable in stages

- Start with the new directory pages and telemetry flags false. Existing dashboard `?requestId=` links and `?editUser=` links remain supported by the legacy editor adapter.
- Set `USER_MANAGEMENT_TELEMETRY_ENABLED=true` after migration verification. Verify creation, approval, block/unblock, sign-in capture, multiple tabs, multiple devices and cross-tenant denial. Existing sessions get an observed binding on their next authenticated request; unknown login methods stay “Not recorded.” Session lifetime follows the current Auth.js rolling twelve-hour application policy; provider offline grants are never used as evidence of online presence.
- For provider-side login failures and logout history, enable event storage in the Keycloak realm and ensure the configured backend administration identity can read events. Test against the deployed Keycloak 24 API. Then set `USER_SECURITY_PROVIDER_EVENTS_ENABLED=true`. The worker polls with an overlapping window and deduplicated event keys; event capture cannot reconstruct events that the provider never retained. Monitor worker errors and the durable `user-security:provider-cursor` in `kv_store`. Unknown/ambiguous failed attempts are retained with null tenant/user attribution and are not leaked into a guessed tenant history.
- `USER_OFFICE_EVIDENCE_ENABLED=true` enables optional network matching and one-shot browser location checks. Before enabling, configure verified office/VPN networks and their expiry under Branch Settings → Office network settings. Configure each operating unit's geofence under Branch Settings → Operating unit geofence; the migration copies any existing branch fence to units in that branch as an initial value. Grant `unit:geofence:manage` only to administrators who should edit those boundaries. Employees use My Sessions → Verify office location, which evaluates only their assigned unit. Precise browser coordinates are not retained. Network suggestions require at least five observed employees, 90% of the observed branch cohort and evidence across three hour buckets in the preceding day; they never auto-create trusted mappings. These are conservative initial heuristics, not attendance rules.

The UI reports last-observed times. Network evidence can be stale and is not proof of physical presence. VPN/shared-IP/CGNAT ambiguity and browser location spoofing remain limitations. Dynamic Jio/Airtel uplinks must be reverified on address changes. Duplicate broad CIDR assignments across offices are rejected.

## Retention and operations

`USER_SECURITY_RETENTION_DAYS` defaults to 90 (supported range 7–3650). Optional check-result retention `USER_LOCATION_RETENTION_DAYS` defaults to 7 (supported range 1–90). The worker deletes bounded batches of expired security events/network observations and delivered notification records. Account access decisions remain part of the administrative record. Backups and provider event retention require separate aligned policies.

Security event records are canonical in `user_security_events`; `audit_logs` remains the general business/configuration audit. Outbox rows hold delivery state, not a duplicate user history. Realtime delivery can be retried; consumers must tolerate duplicate notifications. Local session revocation commits before any best-effort immediate notification; the durable outbox retries disconnection messages. Every subsequent HTTP request checks the membership revocation regardless of replica.

During Redis failure, directory reads must settle with Unknown presence; do not convert monitoring failure into employee Offline status. Provider-event failure must not advance the cursor. The current worker processes up to 5,000 provider events per polling window and reports an error rather than skipping excess history; high-volume deployments need a larger batch strategy/verified event listener before activation.

## Verification checklist

- Cross-tenant, branch and unit list/detail/count/export denial.
- Active-role changes remove protected UI/cache data and rescope realtime rooms.
- Invalid/missing/expired socket token denied; no browser-supplied identity routing or global online list.
- Separate session and IP permissions; CSV spreadsheet formula injection neutralised.
- Block, unblock and single-session revoke with an existing unexpired token; old sessions stay ended.
- A shared identity's other workspace remains accessible after membership-local revocation.
- Invitation expiry, acceptance replay, simultaneous acceptance and resend rotation.
- Redis unavailable, reconnection, socket token refresh and duplicate outbox delivery.
- Office/VPN classification, network verification expiry, stale/replayed location challenges, uncertain accuracy estimates and denied location permission.
- Unit geofence backfill, unit administrator isolation, cross-branch/tenant denial, and employees without an assigned unit.
- Real database migration and authenticated browser checks in a staging environment before production rollout.

## Rollback

Disable new telemetry/location flags and roll back the UI independently if necessary. Preserve the additive tables and security records. Keep socket authentication/scope fixes and membership revocation enforcement in the rollback image: disabling enforcement after revoking sessions could restore their access. Do not drop tables, reactivate old sessions or undo historical access decisions. New hashed invitation tokens require the compatible invitation reader; rollback images must retain hashed-token support or rotate outstanding invitations through a controlled process.
