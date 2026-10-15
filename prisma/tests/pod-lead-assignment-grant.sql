\set ON_ERROR_STOP on
CREATE SCHEMA ats;
CREATE TABLE ats.system_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), system_key text, permissions jsonb);
CREATE TABLE ats.custom_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, system_role_id uuid, is_system boolean, permissions jsonb);
CREATE TABLE ats.audit_logs(tenant_id uuid, actor_id text, action text, target_type text, target_id text, details jsonb);
INSERT INTO ats.system_roles(system_key, permissions) VALUES ('POD_LEAD', '["job:view"]'), ('RECRUITER', '["job:view"]'), ('ACCOUNT_MANAGER', '["job:create"]');
INSERT INTO ats.custom_roles(system_role_id, is_system, permissions)
SELECT id, true, '["job:view","pod:edit"]' FROM ats.system_roles;
INSERT INTO ats.custom_roles(system_role_id, is_system, permissions)
SELECT id, false, '["job:view"]' FROM ats.system_roles WHERE system_key = 'POD_LEAD';
INSERT INTO ats.custom_roles(system_role_id, is_system, permissions)
SELECT id, true, '["job:view","job:assign_recruiter"]' FROM ats.system_roles WHERE system_key = 'POD_LEAD';
\i /tmp/grant.sql
\i /tmp/grant.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM ats.audit_logs) <> 2 THEN RAISE EXCEPTION 'Expected only two newly added grants'; END IF;
  IF EXISTS(SELECT 1 FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id=cr.system_role_id WHERE sr.system_key='POD_LEAD' AND cr.is_system AND NOT (cr.permissions ? 'job:assign_recruiter')) THEN RAISE EXCEPTION 'System lead missing permission'; END IF;
  IF EXISTS(SELECT 1 FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id=cr.system_role_id WHERE (NOT cr.is_system OR sr.system_key<>'POD_LEAD') AND cr.permissions ? 'job:assign_recruiter') THEN RAISE EXCEPTION 'Unrelated role changed'; END IF;
  IF EXISTS(SELECT 1 FROM ats.custom_roles WHERE is_system AND NOT (permissions ? 'job:view')) THEN RAISE EXCEPTION 'Unrelated permission lost'; END IF;
END $$;
UPDATE ats.custom_roles cr SET permissions=permissions-'job:assign_recruiter' WHERE EXISTS(SELECT 1 FROM ats.audit_logs a WHERE a.target_type='role' AND a.target_id=cr.id::text);
\i /tmp/grant.sql
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ats.custom_roles cr JOIN ats.audit_logs a ON a.target_id=cr.id::text AND a.target_type='role' WHERE cr.permissions ? 'job:assign_recruiter') THEN RAISE EXCEPTION 'Explicit disablement was overwritten'; END IF;
END $$;
SELECT 'Pod Lead migration assertions passed' AS result;
\i /tmp/rollback.sql
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ats.system_roles WHERE system_key='POD_LEAD' AND permissions ? 'job:assign_recruiter') THEN RAISE EXCEPTION 'Default rollback failed'; END IF;
  IF (SELECT count(*) FROM ats.custom_roles WHERE permissions ? 'job:assign_recruiter') <> 1 THEN RAISE EXCEPTION 'Rollback removed a pre-existing grant'; END IF;
END $$;
SELECT 'Rollback preserves pre-existing grants' AS result;
