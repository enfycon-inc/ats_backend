-- ATS: rollback-compatible. Create the legacy password reset table only where it is absent.
-- Production already has this table and its data; IF NOT EXISTS adopts it without rewriting rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS ats.password_reset_tokens (
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL,
 user_id UUID NOT NULL,
 token_hash VARCHAR(64) NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 is_used BOOLEAN NOT NULL DEFAULT FALSE,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id),
 CONSTRAINT password_reset_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON DELETE CASCADE,
 CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES ats.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON ats.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON ats.password_reset_tokens(user_id);
COMMIT;
