-- ATS: rollback-compatible. Retain these records when rolling back application images.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.users ADD COLUMN session_valid_after TIMESTAMPTZ;
ALTER TABLE ats.user_invitations ADD COLUMN acceptance_lease UUID, ADD COLUMN accepting_at TIMESTAMPTZ;
CREATE TABLE ats.application_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_subject VARCHAR(255) NOT NULL,
 provider_session VARCHAR(255) NOT NULL,
 provider_client VARCHAR(255) NOT NULL,
 started_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 login_method VARCHAR(64) NOT NULL DEFAULT 'Not recorded',
 device VARCHAR(160) NOT NULL DEFAULT 'Unknown device',
 verified_login BOOLEAN NOT NULL DEFAULT false,
 UNIQUE(provider_subject, provider_session, provider_client)
);
CREATE TABLE ats.session_memberships (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id UUID NOT NULL REFERENCES ats.application_sessions(id),
 user_id UUID NOT NULL REFERENCES ats.users(id),
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 revoked_at TIMESTAMPTZ,
 revoked_by UUID REFERENCES ats.users(id),
 UNIQUE(session_id, user_id)
);
CREATE INDEX session_memberships_user ON ats.session_memberships(tenant_id, user_id, session_id);
CREATE TABLE ats.session_network_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 membership_id UUID NOT NULL REFERENCES ats.session_memberships(id),
 ip_address INET,
 observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX session_network_latest ON ats.session_network_observations(membership_id, observed_at DESC);
CREATE TABLE ats.user_security_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID REFERENCES ats.tenants(id),
 user_id UUID REFERENCES ats.users(id),
 actor_id UUID REFERENCES ats.users(id),
 membership_id UUID REFERENCES ats.session_memberships(id),
 event_key VARCHAR(255) UNIQUE,
 action VARCHAR(80) NOT NULL,
 outcome VARCHAR(32) NOT NULL,
 ip_address INET,
 details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_security_events_user ON ats.user_security_events(tenant_id, user_id, created_at DESC, id);
CREATE TABLE ats.user_access_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 user_id UUID NOT NULL REFERENCES ats.users(id),
 actor_id UUID NOT NULL REFERENCES ats.users(id),
 action VARCHAR(16) NOT NULL CHECK(action IN ('block', 'unblock')),
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_access_decisions_user ON ats.user_access_decisions(tenant_id, user_id, created_at DESC);
CREATE TABLE ats.user_security_outbox (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 room VARCHAR(255) NOT NULL,
 event VARCHAR(80) NOT NULL,
 payload JSONB NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_id UUID,
 available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_security_outbox_ready ON ats.user_security_outbox(status, available_at);
CREATE INDEX users_management_state ON ats.users(tenant_id, is_approved, is_active, full_name, id);
CREATE INDEX invitations_management_state ON ats.user_invitations(tenant_id, is_accepted, created_at DESC);
COMMIT;
