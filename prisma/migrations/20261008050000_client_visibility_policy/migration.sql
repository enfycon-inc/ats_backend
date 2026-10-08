-- ATS: rollback-compatible
-- Reviewed additive change: retained backend images do not require this column.
-- Existing tenant rows receive false; no columns or existing data are removed.
-- Keep the column when rolling back application images.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.tenants ADD COLUMN clients_visible_across_units boolean NOT NULL DEFAULT false;
COMMIT;
