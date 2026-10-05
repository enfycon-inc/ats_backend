SELECT id as role_id, permissions FROM custom_roles LIMIT 1 UNION ALL SELECT id as role_id, permissions FROM system_roles LIMIT 1;
