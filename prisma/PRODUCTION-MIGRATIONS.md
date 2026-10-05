# Production schema changes

Production application startup does not run Prisma db push. Review each SQL change, back up affected data, then run `node prisma/apply-reviewed-migrations.cjs` explicitly before deploying code that requires it. The runner applies only its reviewed list, transactionally, and records completed migrations. It does not create a new database or reconcile the whole Prisma schema.

The initial reviewed change adds nullable jobs.business_unit_id and is safe to apply to the existing database. Existing jobs retain their values. Fresh database provisioning needs a separately reviewed baseline; this runner is not a baseline installer.

Legacy jobs.business_unit, remote_job, assigned_approver_role, work_start_time, work_end_time, working_days and timing_snapshot_at are no longer created by JobsService. Existing columns are retained until a separate reviewed removal migration and backup. Branch and operating-unit work schedules remain in use.

Other pre-existing services still contain startup schema/seed operations, notably AuthInitService. This change removes job startup mutations and whole-schema Prisma synchronization; it does not claim all service startup is read-only.
