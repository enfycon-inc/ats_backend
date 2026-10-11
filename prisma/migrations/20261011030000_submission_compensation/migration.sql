-- Additive submission snapshots. Existing CTC records retain their original units.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.recruiter_submissions
 ADD COLUMN current_compensation_amount decimal(12,2),
 ADD COLUMN expected_compensation_amount decimal(12,2),
 ADD COLUMN compensation_currency varchar(10),
 ADD COLUMN compensation_period varchar(10),
 ADD COLUMN compensation_input_unit varchar(10),
 ADD COLUMN source_category varchar(20),
 ADD COLUMN source_channel varchar(60),
 ADD COLUMN source_detail varchar(255),
 ADD COLUMN availability_to_start varchar(100);
COMMIT;
