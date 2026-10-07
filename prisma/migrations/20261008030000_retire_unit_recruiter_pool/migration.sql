-- Pool routing did not persist a pool marker on jobs. Existing explicit
-- job_recruiters and job_pods mappings are preserved, with no guessed assignments.
ALTER TABLE ats.business_units DROP COLUMN IF EXISTS allow_all;
