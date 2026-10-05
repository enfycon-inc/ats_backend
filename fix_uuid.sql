ALTER TABLE ats.recruiter_submissions ALTER COLUMN candidate_id TYPE UUID USING candidate_id::uuid;
