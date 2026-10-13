-- ATS: rollback-compatible
-- Additive nullable user metadata; existing application versions ignore this column.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TYPE ats."UserCity" AS ENUM ('BBSR', 'PUNE', 'BENGALURU', 'VIZAG', 'HYDERABAD');
ALTER TABLE ats.users ADD COLUMN city ats."UserCity";
COMMIT;
