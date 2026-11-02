
-- ATS: rollback-compatible
-- ATS: additive default capability grant; preserves existing role permissions.
ALTER TABLE ats.candidates ADD COLUMN linkedin_url VARCHAR(500);
