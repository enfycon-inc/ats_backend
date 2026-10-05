SELECT id as role_id, permissions FROM custom_roles WHERE tenant_id = '00000000-0000-0000-0000-000000000000' UNION ALL SELECT id as role_id, permissions FROM system_roles;
