-- Preserve append-only history except for explicitly authorized permanent deletion.
-- The backend sets both values locally in the same transaction after authorization.
BEGIN;
CREATE OR REPLACE FUNCTION ats.protect_submission_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('ats.permanent_delete_tenant', true) = OLD.tenant_id::text
    AND OLD.submission_id::text = ANY(string_to_array(current_setting('ats.permanent_delete_submissions', true), ','))
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Submission history is immutable' USING ERRCODE = '23514';
END;
$$;
COMMIT;
