-- ATS: rollback-compatible
-- Additive only. Older application versions ignore these preferences and delivery records.
-- Rollback: stop the new email worker before reverting application images; retain data.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.user_notification_settings ADD COLUMN email_preferences JSONB NOT NULL DEFAULT '{}';
CREATE TABLE ats.system_email_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 recipient_id UUID NOT NULL REFERENCES ats.users(id),
 event_id UUID NOT NULL,
 category VARCHAR(50) NOT NULL,
 payload JSONB NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 lease_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(event_id, recipient_id, category)
);
CREATE INDEX system_email_deliveries_ready ON ats.system_email_deliveries(status, available_at);
COMMIT;
