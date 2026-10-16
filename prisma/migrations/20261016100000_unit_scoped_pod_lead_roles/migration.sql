-- ATS: rollback-compatible
-- Replaces the Pod Lead singleton guard with one custom role per tenant unit.
-- Null-unit scope remains temporarily accepted by the database for rollback compatibility;
-- application writes require a unit and the UI guides legacy roles to a unit.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION ats.enforce_single_custom_pod_lead_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unit_branch_id uuid;
BEGIN
  IF NEW.is_system = false AND EXISTS (
    SELECT 1 FROM ats.system_roles WHERE id = NEW.system_role_id AND system_key = 'POD_LEAD'
  ) THEN
    IF NEW.business_unit_id IS NULL THEN
      -- Let the previous app version continue its tenant-wide writes during rollback.
      PERFORM pg_advisory_xact_lock(hashtextextended('pod-lead-role:' || NEW.tenant_id::text || ':legacy', 0));
      IF EXISTS (
        SELECT 1 FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id
        WHERE cr.tenant_id = NEW.tenant_id AND cr.is_system = false AND sr.system_key = 'POD_LEAD'
          AND cr.business_unit_id IS NULL AND cr.id <> NEW.id
      ) THEN
        RAISE EXCEPTION 'Only one legacy tenant-wide Pod Lead role is allowed per tenant' USING ERRCODE = '23505';
      END IF;
    ELSE
      SELECT bu.branch_id INTO unit_branch_id
        FROM ats.business_units bu
        WHERE bu.id = NEW.business_unit_id AND bu.tenant_id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The Pod Lead role branch unit must belong to the same tenant' USING ERRCODE = '23503';
      END IF;
      IF NEW.branch_id IS DISTINCT FROM unit_branch_id THEN
        RAISE EXCEPTION 'The Pod Lead role branch must match its branch unit' USING ERRCODE = '23514';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended('pod-lead-role:' || NEW.tenant_id::text || ':' || NEW.business_unit_id::text, 0));
    END IF;
    IF EXISTS (
      SELECT 1 FROM ats.custom_roles cr
      JOIN ats.system_roles sr ON sr.id = cr.system_role_id
      WHERE cr.tenant_id = NEW.tenant_id AND cr.business_unit_id IS NOT DISTINCT FROM NEW.business_unit_id
        AND cr.is_system = false AND sr.system_key = 'POD_LEAD' AND cr.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Only one custom Pod Lead role is allowed per branch unit' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
