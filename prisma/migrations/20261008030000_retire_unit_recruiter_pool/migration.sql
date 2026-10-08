-- ATS: rollback-compatible
-- Logical pool retirement only. Preserve allow_all for retained backend images.
-- Production history was checked: this migration has not been applied.
-- Physical deletion is tracked in prisma/schema-cleanups.json.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT 1;
COMMIT;
