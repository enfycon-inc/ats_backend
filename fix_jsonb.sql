ALTER TABLE ats.custom_roles ALTER COLUMN permissions TYPE JSONB USING permissions::jsonb;
