ALTER TABLE ats.market_segments
DROP COLUMN IF EXISTS tenant_id,
DROP COLUMN IF EXISTS default_timezone,
DROP COLUMN IF EXISTS default_shift,
DROP COLUMN IF EXISTS default_start_time,
DROP COLUMN IF EXISTS default_end_time;
