# Restricted developer sign-in

Apply `20261021060000_restricted_developer_login` before deploying the backend or frontend. The new setting defaults off. Existing password and provider settings are retained.

In Company → Authentication & SSO, a tenant administrator enables Developer Access and saves Authentication Methods. Under Authorized accounts, search for existing active approved members and grant access. Account grants save immediately; the tenant toggle saves with the other sign-in options. The public login disclosure stays collapsed beneath normal methods.

Developer sign-in requires exact tenant resolution, an individual grant, valid existing Keycloak credentials, and an active approved tenant membership. It grants no additional application permissions. No account bootstrap or environment password recovery is permitted on this endpoint. Workspace-required MFA blocks this password-only flow rather than bypassing the requirement; the settings UI explains this restriction.

Developer session markers bind each Keycloak session to the granted membership and policy generation. Disabling the setting rotates the generation, including under concurrent issuance. Removing a grant deletes its unique identifier; granting access again creates a different identifier. Previously revoked sessions cannot revive. Session and membership checks run on authenticated requests and token refresh, without an authorization cache. Retain session markers until the corresponding Keycloak session can no longer issue usable tokens; deleting markers prematurely would remove channel-specific enforcement.

The public policy contains only flags and public provider configuration. Account eligibility is available only through tenant-scoped `tenant:settings` endpoints. Administrative grant and policy changes use the existing audit log.

Rollback: disable Developer Access first to invalidate developer sessions, then restore the prior application version. Retain additive database structures until rollback compatibility is confirmed. Do not roll back the migration while the new backend is running.

Local verification includes focused authentication tests, frontend component/policy tests, TypeScript checks, and Prisma validation. Live PostgreSQL migration, browser visual checks, and real Keycloak sign-in require the running integration environment; these checks are not replaced by the mockup or unit tests.
