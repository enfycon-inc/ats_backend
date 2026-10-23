-- ATS: rollback-compatible
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ats.career_oauth_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, created_by uuid NOT NULL,
 name varchar(120) NOT NULL, secret_hash varchar(64) NOT NULL, scope varchar(20) NOT NULL,
 branch_id uuid, business_unit_id uuid, allowed_origins text[] NOT NULL DEFAULT ARRAY[]::text[],
 expires_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT career_oauth_clients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT career_oauth_clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES ats.users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT career_oauth_clients_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT career_oauth_clients_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES ats.business_units(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT career_oauth_clients_scope_assignment CHECK (
  (scope = 'TENANT' AND branch_id IS NULL AND business_unit_id IS NULL) OR
  (scope = 'BRANCH' AND branch_id IS NOT NULL AND business_unit_id IS NULL) OR
  (scope = 'BUSINESS_UNIT' AND branch_id IS NOT NULL AND business_unit_id IS NOT NULL))
);
CREATE INDEX career_oauth_clients_tenant_id_idx ON ats.career_oauth_clients(tenant_id);
CREATE TABLE ats.career_oauth_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, token_hash varchar(64) NOT NULL,
 expires_at timestamptz NOT NULL,
 CONSTRAINT career_oauth_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES ats.career_oauth_clients(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX career_oauth_tokens_token_hash_key ON ats.career_oauth_tokens(token_hash);
CREATE INDEX career_oauth_tokens_expires_at_idx ON ats.career_oauth_tokens(expires_at);
COMMIT;
