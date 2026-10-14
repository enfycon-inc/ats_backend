// Role bundles are configuration. Request authorization continues to use only
// granular capabilities, never role-name checks.
export const SUBMISSION_ROLE_POLICY_SQL = `
WITH RECURSIVE recruiter_roles(id) AS (
  SELECT cr.id FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id
  WHERE sr.system_key = 'RECRUITER'
  UNION
  SELECT cr.id FROM ats.custom_roles cr JOIN recruiter_roles parent ON cr.base_role_id = parent.id
)
UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) - ARRAY[
  '*', 'submission:edit', 'submission:edit_rate', 'submission:internal_screening',
  'submission:approve_client', 'submission:schedule_interview', 'submission:audit_rounds',
  'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status'
]::text[]
FROM recruiter_roles r WHERE cr.id = r.id;

UPDATE ats.system_roles SET permissions = COALESCE(permissions, '[]'::jsonb) - ARRAY[
  '*', 'submission:edit', 'submission:edit_rate', 'submission:internal_screening',
  'submission:approve_client', 'submission:schedule_interview', 'submission:audit_rounds',
  'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status'
]::text[] WHERE system_key = 'RECRUITER';

UPDATE ats.system_roles SET permissions = (
  SELECT jsonb_agg(DISTINCT permission) FROM jsonb_array_elements_text(
    COALESCE(permissions, '[]'::jsonb) || '["submission:view","submission:schedule_interview","submission:audit_rounds","submission:audit_l1","submission:audit_l2","submission:audit_l3","submission:final_status","submission:edit"]'::jsonb
  ) AS item(permission)
) WHERE system_key = 'ACCOUNT_MANAGER';

WITH RECURSIVE account_manager_roles(id) AS (
  SELECT cr.id FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id
  WHERE sr.system_key = 'ACCOUNT_MANAGER'
  UNION
  SELECT cr.id FROM ats.custom_roles cr JOIN account_manager_roles parent ON cr.base_role_id = parent.id
)
UPDATE ats.custom_roles cr SET permissions = (
  SELECT jsonb_agg(DISTINCT permission) FROM jsonb_array_elements_text(
    COALESCE(cr.permissions, '[]'::jsonb) || '["submission:view","submission:schedule_interview","submission:audit_rounds","submission:audit_l1","submission:audit_l2","submission:audit_l3","submission:final_status","submission:edit"]'::jsonb
  ) AS item(permission)
) FROM account_manager_roles am WHERE cr.id = am.id
AND NOT EXISTS (SELECT 1 FROM ats.system_roles sr WHERE sr.id = cr.system_role_id AND sr.system_key = 'RECRUITER');
`;
