-- ATS: rollback-compatible. Unit-specific geofence policies. Branch-level networks remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ats.business_unit_geofences (
 business_unit_id UUID PRIMARY KEY REFERENCES ats.business_units(id) ON DELETE CASCADE,
 tenant_id UUID NOT NULL REFERENCES ats.tenants(id),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_metres INTEGER NOT NULL CHECK(radius_metres BETWEEN 25 AND 5000),
 updated_by UUID NOT NULL REFERENCES ats.users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX business_unit_geofences_tenant ON ats.business_unit_geofences(tenant_id);
ALTER TABLE ats.office_location_checks ADD COLUMN business_unit_id UUID REFERENCES ats.business_units(id) ON DELETE SET NULL;
CREATE INDEX office_location_checks_unit ON ats.office_location_checks(tenant_id,business_unit_id,created_at DESC);
-- Preserve existing branch configuration as an initial value for each unit in that branch.
INSERT INTO ats.business_unit_geofences(business_unit_id,tenant_id,latitude,longitude,radius_metres,updated_by,updated_at)
SELECT bu.id,bg.tenant_id,bg.latitude,bg.longitude,bg.radius_metres,bg.updated_by,bg.updated_at
FROM ats.branch_geofences bg JOIN ats.business_units bu ON bu.branch_id=bg.branch_id AND bu.tenant_id=bg.tenant_id
ON CONFLICT(business_unit_id) DO NOTHING;
COMMIT;
