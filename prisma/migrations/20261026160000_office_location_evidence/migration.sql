-- ATS: rollback-compatible. Optional evidence collection is disabled by default.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ats.branch_networks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 branch_id UUID NOT NULL REFERENCES ats.branches(id),
 network CIDR NOT NULL,
 kind VARCHAR(16) NOT NULL CHECK(kind IN ('office','vpn')),
 verified_by UUID NOT NULL REFERENCES ats.users(id),
 verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 UNIQUE(tenant_id,branch_id,network)
);
CREATE INDEX branch_networks_tenant ON ats.branch_networks(tenant_id,expires_at);
CREATE TABLE ats.branch_geofences (
 branch_id UUID PRIMARY KEY REFERENCES ats.branches(id),
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_metres INTEGER NOT NULL CHECK(radius_metres BETWEEN 25 AND 5000),
 updated_by UUID NOT NULL REFERENCES ats.users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE ats.office_location_checks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 user_id UUID NOT NULL REFERENCES ats.users(id),
 branch_id UUID NOT NULL REFERENCES ats.branches(id),
 result VARCHAR(16) NOT NULL CHECK(result IN ('within','outside','uncertain')),
 accuracy_metres DOUBLE PRECISION NOT NULL,
 sampled_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX office_location_checks_user ON ats.office_location_checks(tenant_id,user_id,created_at DESC);
COMMIT;
