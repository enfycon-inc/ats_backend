-- ATS: rollback-compatible
-- Additive only: previous images can ignore the new tables and defaulted columns.
-- Disable Developer Access before application rollback; retain all session markers.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.tenant_auth_settings ADD COLUMN allow_developer_login boolean NOT NULL DEFAULT false,
 ADD COLUMN developer_login_epoch uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE ats.developer_login_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES ats.users(id) ON DELETE CASCADE,
 granted_by uuid REFERENCES ats.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id)
);
CREATE TABLE ats.developer_login_sessions (
 keycloak_id varchar(255) NOT NULL,
 session_id varchar(255) NOT NULL,
 grant_id uuid,
 tenant_id uuid NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
 policy_epoch uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(keycloak_id,session_id)
);
CREATE INDEX developer_sessions_tenant ON ats.developer_login_sessions(tenant_id);
-- Keep session markers after grant deletion: re-granting must never revive old sessions.

COMMIT;
