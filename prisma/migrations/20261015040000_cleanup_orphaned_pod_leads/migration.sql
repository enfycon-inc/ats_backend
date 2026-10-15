-- ATS: rollback-compatible
-- One-time data cleanup: strips orphaned POD_LEAD role IDs from assigned_role_ids / role_id for users who no longer lead any active pod.
BEGIN;
SET LOCAL lock_timeout = '5s';

WITH pod_lead_roles AS (
  SELECT cr.id, cr.tenant_id
  FROM ats.custom_roles cr
  JOIN ats.system_roles sr ON cr.system_role_id = sr.id
  WHERE sr.system_key = 'POD_LEAD'
),
active_pod_leads AS (
  SELECT DISTINCT p.pod_head_id AS user_id
  FROM ats.pods p
  WHERE p.pod_head_id IS NOT NULL
),
candidates AS (
  SELECT u.id, u.tenant_id, u.branch_id, u.role_id, u.assigned_role_ids
  FROM ats.users u
  WHERE (
    EXISTS (
      SELECT 1 FROM pod_lead_roles plr
      WHERE plr.tenant_id = u.tenant_id
        AND (plr.id = u.role_id OR plr.id = ANY(COALESCE(u.assigned_role_ids, ARRAY[]::uuid[])))
    )
  )
  AND u.id NOT IN (SELECT user_id FROM active_pod_leads)
),
resolved AS (
  SELECT c.id,
    (
      SELECT cr.id FROM ats.custom_roles cr
      JOIN ats.system_roles sr ON cr.system_role_id = sr.id
      WHERE sr.system_key = 'RECRUITER' AND cr.tenant_id = c.tenant_id
        AND (cr.branch_id = c.branch_id OR cr.branch_id IS NULL)
      ORDER BY (cr.branch_id = c.branch_id) DESC, cr.created_at ASC
      LIMIT 1
    ) AS default_recruiter_role_id,
    EXISTS (
      SELECT 1 FROM unnest(COALESCE(c.assigned_role_ids, ARRAY[]::uuid[])) AS r_id
      JOIN ats.custom_roles cr ON cr.id = r_id
      JOIN ats.system_roles sr ON cr.system_role_id = sr.id
      WHERE sr.system_key = 'RECRUITER' AND cr.tenant_id = c.tenant_id
    ) AS has_recruiter_role,
    ARRAY(
      SELECT r_id FROM unnest(COALESCE(c.assigned_role_ids, ARRAY[]::uuid[])) AS r_id
      WHERE r_id NOT IN (SELECT plr.id FROM pod_lead_roles plr WHERE plr.tenant_id = c.tenant_id)
    ) AS stripped_roles
  FROM candidates c
),
normalized AS (
  SELECT r.id,
    r.default_recruiter_role_id,
    CASE
      WHEN NOT r.has_recruiter_role AND r.default_recruiter_role_id IS NOT NULL AND array_length(r.stripped_roles, 1) IS NULL
        THEN ARRAY[r.default_recruiter_role_id]
      WHEN NOT r.has_recruiter_role AND r.default_recruiter_role_id IS NOT NULL
        THEN array_append(r.stripped_roles, r.default_recruiter_role_id)
      ELSE r.stripped_roles
    END AS new_assigned_roles
  FROM resolved r
),
changed AS (
  UPDATE ats.users u
  SET
    role_id = CASE
      WHEN u.role_id IN (SELECT plr.id FROM pod_lead_roles plr WHERE plr.tenant_id = u.tenant_id)
        THEN COALESCE(n.default_recruiter_role_id, n.new_assigned_roles[1], u.role_id)
      ELSE u.role_id
    END,
    assigned_role_ids = n.new_assigned_roles,
    updated_at = NOW()
  FROM normalized n
  WHERE u.id = n.id
  RETURNING u.id, u.tenant_id, u.role_id, u.assigned_role_ids
)
INSERT INTO ats.audit_logs (tenant_id, actor_id, action, target_type, target_id, details)
SELECT tenant_id, 'migration:20261015040000', 'CLEANUP_ORPHANED_POD_LEAD_ROLE', 'user', id::text,
  json_build_object('roleId', role_id, 'assignedRoleIds', assigned_role_ids)::jsonb FROM changed;

COMMIT;
