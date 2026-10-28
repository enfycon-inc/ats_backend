-- Store the unit and currency for the latest candidate profile compensation.
-- Existing domestic profile values have historically been displayed as INR LPA.
-- ATS: rollback-compatible
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.candidates
  ADD COLUMN IF NOT EXISTS ctc_currency varchar(10),
  ADD COLUMN IF NOT EXISTS ctc_term varchar(10);

UPDATE ats.candidates
SET ctc_currency = COALESCE(ctc_currency, 'INR'),
    ctc_term = COALESCE(ctc_term, 'LPA')
WHERE upper(market) IN ('IN', 'IND', 'INDIA')
  AND (ctc_currency IS NULL OR ctc_term IS NULL);

COMMIT;
