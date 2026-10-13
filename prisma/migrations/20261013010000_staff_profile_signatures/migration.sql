-- ATS: rollback-compatible
-- Additive tables only; older application versions continue using users unchanged.
-- Retain these tables on application rollback to preserve users' saved details.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ats.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES ats.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
  phone VARCHAR(50), designation VARCHAR(255),
  new_message_signature_id UUID, reply_signature_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_profiles_tenant_id_idx ON ats.user_profiles(tenant_id);
CREATE TABLE ats.user_photos (
  user_id UUID PRIMARY KEY REFERENCES ats.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
  data BYTEA NOT NULL CHECK (octet_length(data) <= 524288),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_photos_tenant_id_idx ON ats.user_photos(tenant_id);
CREATE TABLE ats.email_signatures (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES ats.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES ats.tenants(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  html TEXT NOT NULL CHECK (octet_length(html) <= 32768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX email_signatures_tenant_user_idx ON ats.email_signatures(tenant_id, user_id);
ALTER TABLE ats.user_profiles ADD CONSTRAINT user_profiles_new_message_signature_id_fkey
  FOREIGN KEY (new_message_signature_id) REFERENCES ats.email_signatures(id) ON DELETE SET NULL;
ALTER TABLE ats.user_profiles ADD CONSTRAINT user_profiles_reply_signature_id_fkey
  FOREIGN KEY (reply_signature_id) REFERENCES ats.email_signatures(id) ON DELETE SET NULL;
COMMIT;
