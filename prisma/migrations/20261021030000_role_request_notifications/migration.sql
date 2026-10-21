-- ATS: rollback-compatible
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.users ADD COLUMN role_request_version UUID;

CREATE TABLE ats.role_request_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  requester_id UUID NOT NULL,
  recipient_id UUID NOT NULL,
  request_version UUID NOT NULL,
  channel VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_id UUID,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT role_request_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT role_request_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT role_request_deliveries_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES ats.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT role_request_deliveries_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES ats.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT role_request_deliveries_channel_check CHECK (channel IN ('email', 'in_app')),
  CONSTRAINT role_request_deliveries_status_check CHECK (status IN ('pending', 'sending', 'accepted', 'cancelled', 'failed'))
);
CREATE UNIQUE INDEX role_request_delivery_unique ON ats.role_request_deliveries(requester_id, request_version, recipient_id, channel);
CREATE INDEX role_request_delivery_ready ON ats.role_request_deliveries(status, available_at);
CREATE INDEX role_request_delivery_tenant ON ats.role_request_deliveries(tenant_id);
CREATE INDEX role_request_delivery_recipient ON ats.role_request_deliveries(recipient_id);
COMMIT;
