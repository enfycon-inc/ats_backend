ALTER TABLE ats.candidates
ADD COLUMN preferred_location_mode VARCHAR(30);

ALTER TABLE ats.recruiter_submissions
ADD COLUMN candidate_preferred_location_mode VARCHAR(30);
