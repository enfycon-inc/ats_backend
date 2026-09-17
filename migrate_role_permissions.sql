-- 1. Add the permissions column to custom_roles
ALTER TABLE custom_roles
ADD COLUMN permissions JSONB DEFAULT '[]'::jsonb;

-- 2. Migrate existing permissions
UPDATE custom_roles cr
SET permissions = (
  SELECT COALESCE(jsonb_agg(permission), '[]'::jsonb)
  FROM role_permissions rp
  WHERE rp.role_id = cr.id
);

-- 3. Drop the role_permissions table
DROP TABLE role_permissions;
