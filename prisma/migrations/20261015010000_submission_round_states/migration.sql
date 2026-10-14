BEGIN;
SET LOCAL lock_timeout = '5s';

-- Validate new writes without rewriting legacy states or their audit history.
-- Application enums remain canonical; text storage avoids a destructive cast.
CREATE FUNCTION ats.validate_submission_workflow_values() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name text; new_value text; old_value text;
BEGIN
  FOREACH field_name IN ARRAY ARRAY['l1_status', 'l2_status', 'l3_status'] LOOP
    new_value := to_jsonb(NEW)->>field_name;
    old_value := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->>field_name ELSE NULL END;
    IF (TG_OP = 'INSERT' OR new_value IS DISTINCT FROM old_value) AND new_value IS NOT NULL AND
       new_value NOT IN ('PENDING', 'SCHEDULED', 'AWAITING_FEEDBACK', 'CLEARED', 'REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid interview round status' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF (TG_OP = 'INSERT' OR NEW.final_status IS DISTINCT FROM OLD.final_status) AND
     NEW.final_status NOT IN ('PENDING_APPROVAL', 'SUBMITTED', 'SELECTED', 'NOT_SELECTED', 'OFFER', 'JOIN', 'WITHDRAWN', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid submission outcome' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submission_workflow_values BEFORE INSERT OR UPDATE ON ats.recruiter_submissions
  FOR EACH ROW EXECUTE FUNCTION ats.validate_submission_workflow_values();

-- Audit events can only be appended. Deleting a submission cannot erase history.
CREATE FUNCTION ats.protect_submission_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submission history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER submission_history_immutable BEFORE UPDATE OR DELETE ON ats.submission_events
  FOR EACH ROW EXECUTE FUNCTION ats.protect_submission_history();
COMMIT;
