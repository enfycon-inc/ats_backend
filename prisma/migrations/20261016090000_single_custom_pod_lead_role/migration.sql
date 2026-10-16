-- ATS: rollback-compatible
-- Adds lifecycle validation only; earlier application binaries remain readable.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Additive lifecycle guard. Existing duplicate roles require separate reviewed reconciliation.
CREATE OR REPLACE FUNCTION ats.enforce_single_custom_pod_lead_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_system = false AND EXISTS (SELECT 1 FROM ats.system_roles WHERE id=NEW.system_role_id AND system_key='POD_LEAD') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pod-lead-role:' || NEW.tenant_id::text, 0));
    IF EXISTS (SELECT 1 FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id=cr.system_role_id WHERE cr.tenant_id=NEW.tenant_id AND cr.is_system=false AND sr.system_key='POD_LEAD' AND cr.id<>NEW.id) THEN
      RAISE EXCEPTION 'Only one custom Pod Lead role is allowed per tenant' USING ERRCODE='23505';
    END IF;
    IF NEW.branch_id IS NOT NULL OR NEW.business_unit_id IS NOT NULL THEN
      RAISE EXCEPTION 'The custom Pod Lead role must have tenant-wide scope' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER single_custom_pod_lead_role
BEFORE INSERT OR UPDATE ON ats.custom_roles
FOR EACH ROW EXECUTE FUNCTION ats.enforce_single_custom_pod_lead_role();

COMMIT;
