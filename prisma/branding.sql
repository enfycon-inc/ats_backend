-- Add branding fields without changing existing tenant data. Safe to rerun.
ALTER TABLE ats.tenants ADD COLUMN IF NOT EXISTS site_title VARCHAR(255);
ALTER TABLE ats.tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
-- The company form stores uploaded images as data URLs, which exceed 2048 chars.
ALTER TABLE ats.tenants ALTER COLUMN logo_url TYPE TEXT;
