-- ATS: rollback-compatible
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.jobs
  ADD COLUMN IF NOT EXISTS public_slug varchar(180),
  ADD COLUMN IF NOT EXISTS public_description text,
  ADD COLUMN IF NOT EXISTS is_publicly_published boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_public_slug_key
  ON ats.jobs(public_slug);

CREATE INDEX IF NOT EXISTS jobs_public_feed_idx
  ON ats.jobs(tenant_id, branch_id, business_unit_id, created_at DESC)
  WHERE is_publicly_published = true AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ats.public_jobs_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  key_prefix varchar(24) NOT NULL,
  key_hash varchar(64) NOT NULL UNIQUE,
  scope varchar(20) NOT NULL CHECK (scope IN ('TENANT', 'BRANCH', 'BUSINESS_UNIT')),
  branch_id uuid,
  business_unit_id uuid,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES ats.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_jobs_api_keys_scope_assignment_check CHECK (
    (scope = 'TENANT' AND branch_id IS NULL AND business_unit_id IS NULL) OR
    (scope = 'BRANCH' AND branch_id IS NOT NULL AND business_unit_id IS NULL) OR
    (scope = 'BUSINESS_UNIT' AND business_unit_id IS NOT NULL)
  ),
  CONSTRAINT public_jobs_api_keys_branch_fk FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON DELETE CASCADE,
  CONSTRAINT public_jobs_api_keys_business_unit_fk FOREIGN KEY (business_unit_id) REFERENCES ats.business_units(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS public_jobs_api_keys_tenant_lifecycle_idx
  ON ats.public_jobs_api_keys(tenant_id, revoked_at, expires_at);

COMMIT;
