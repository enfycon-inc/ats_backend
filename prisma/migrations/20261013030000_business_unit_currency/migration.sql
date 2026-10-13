-- ATS: rollback-compatible
-- Persist an operating-unit currency override while allowing existing rows to
-- continue inheriting their market segment's configured default.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.business_units ADD COLUMN currency VARCHAR(10);
COMMIT;
