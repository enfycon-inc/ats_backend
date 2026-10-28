-- ATS: rollback-compatible
-- Additive consent/login tables; existing images continue using manual checks.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ats.office_login_instances (
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL REFERENCES ats.session_memberships(id) ON DELETE CASCADE,
  request_hash varchar(64) NOT NULL,
  receipt_hash varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(membership_id,request_hash)
);
CREATE INDEX office_login_expiry ON ats.office_login_instances(expires_at);
CREATE TABLE ats.office_browser_preferences (
  user_id uuid NOT NULL REFERENCES ats.users(id) ON DELETE CASCADE,
  browser_hash varchar(64) NOT NULL,
  origin varchar(255) NOT NULL,
  decision varchar(16) NOT NULL CHECK(decision IN ('accepted','declined')),
  notice_version varchar(40) NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,browser_hash,origin)
);
CREATE TABLE ats.office_login_location_states (
  login_id uuid NOT NULL REFERENCES ats.office_login_instances(id) ON DELETE CASCADE,
  browser_hash varchar(64) NOT NULL,
  origin varchar(255) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  notice_version varchar(40) NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  manual boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(login_id,browser_hash,origin)
);
ALTER TABLE ats.office_location_checks
  ADD COLUMN login_id uuid REFERENCES ats.office_login_instances(id) ON DELETE SET NULL,
  ADD COLUMN source varchar(16) NOT NULL DEFAULT 'manual';
CREATE INDEX office_checks_login ON ats.office_location_checks(login_id);
COMMIT;
