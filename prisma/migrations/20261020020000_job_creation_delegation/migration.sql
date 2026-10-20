-- ATS: rollback-compatible
-- Additive delegation support; rollback can drop the optional audit column and grants table.
ALTER TABLE ats.jobs
  ADD COLUMN created_by_user_id uuid;

ALTER TABLE ats.jobs
  ADD CONSTRAINT jobs_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES ats.users(id) ON DELETE SET NULL;

CREATE INDEX jobs_tenant_created_by_user_idx
  ON ats.jobs (tenant_id, created_by_user_id);

CREATE TABLE ats.job_creation_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
  account_manager_id uuid NOT NULL REFERENCES ats.users(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES ats.users(id) ON DELETE CASCADE,
  granted_by_user_id uuid REFERENCES ats.users(id) ON DELETE SET NULL,
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT job_creation_grants_not_self CHECK (account_manager_id <> delegate_user_id),
  CONSTRAINT job_creation_grants_owner_delegate_key UNIQUE (tenant_id, account_manager_id, delegate_user_id)
);

CREATE INDEX job_creation_grants_delegate_active_idx
  ON ats.job_creation_grants (tenant_id, delegate_user_id, revoked_at);
