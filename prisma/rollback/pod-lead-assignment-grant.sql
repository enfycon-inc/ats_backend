-- Run only when rolling back the approved Pod Lead default correction.
-- Revert the application seed alongside this operation.
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE ats.custom_roles cr SET permissions = cr.permissions - 'job:assign_recruiter'
WHERE EXISTS (SELECT 1 FROM ats.audit_logs a WHERE a.action = 'POD_LEAD_ASSIGNMENT_GRANT_V1'
  AND a.target_type = 'role' AND a.target_id = cr.id::text);
UPDATE ats.system_roles sr SET permissions = sr.permissions - 'job:assign_recruiter'
WHERE EXISTS (SELECT 1 FROM ats.audit_logs a WHERE a.action = 'POD_LEAD_ASSIGNMENT_GRANT_V1'
  AND a.target_type = 'system_role' AND a.target_id = sr.id::text);
-- Preserve audit receipts so manual reruns cannot regrant removed capabilities.
COMMIT;
