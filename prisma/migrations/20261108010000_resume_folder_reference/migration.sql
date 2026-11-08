-- ATS: rollback-compatible
-- Additive only. All original file_data values and existing records are preserved.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.resumes ADD COLUMN storage_key TEXT;
COMMIT;
