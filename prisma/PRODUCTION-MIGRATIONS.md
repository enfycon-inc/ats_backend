# Prisma database migrations

Prisma 6.19.3 is the schema migration system. The custom reviewed-schema ledger
runner has been removed. Application startup must not run `db push`, reset, or
apply migrations concurrently from backend replicas.

## Baseline adopted on 7 October 2026

`migrations/0_production_baseline/migration.sql` contains the existing ATS and
mass-mail structures, shared parser tables, foreign keys, indexes, sequences,
and UUID/text compatibility operators. It contains no production records and no
Keycloak objects. Existing application model/field names remain unchanged; the
previously unmodeled parser tables and skills category reference are now tracked.

The current VPS was backed up, compared to the schema, and adopted with
`prisma migrate resolve --applied 0_production_baseline`. Application structures
were verified unchanged, and `prisma migrate deploy`/`status` report up to date.
Do not replay this baseline SQL against an existing populated database.

## Future changes

1. Use a separate development database and a separate shadow database. Never
   point `migrate dev` or reset at production or a teammate's shared database.
2. Change `schema.prisma`, then run `npm run db:migrate:create -- --name change_name`.
3. Review the generated SQL. Keep already-applied migrations immutable. Commit
   schema and migration files together; migration SQL is checked out with LF.
4. For automated blue/green deployment, additive changes must be explicitly
   reviewed and include `-- ATS: rollback-compatible`, `BEGIN;`,
   `SET LOCAL lock_timeout = '5s';`, and `COMMIT;`. Review defaults, constraints,
   existing rows, and compatibility with the active/previous application images.
5. Run `npm run db:migrate:deploy` against a disposable test database. Check the
   intended change and repeat the command to verify no pending migrations remain.
6. CI checks/builds the image. The VPS backs up before invoking the image's
   standard `prisma migrate deploy`, verifies schema drift, then starts/checks
   the candidate. Failed CI never reaches the VPS.

Destructive/data-changing migrations and existing-column alterations require a
separate planned change; automatic deployment rejects them. Use expand/contract
changes across releases. Rollback changes application routing, not database data.
A failed migration requires investigation and an explicit Prisma resolution;
the deployer never automatically marks a failed migration successful.

Fresh databases run `npm run db:migrate:deploy` to apply the baseline, then run
explicit application/admin provisioning. Legacy `deployment/production` SQL
files are historical provisioning artifacts, not a second migration history.
Do not combine legacy table-creation scripts with Prisma baseline replay.

The existing five application unit-test failures are independent of migrations
and still block new backend builds. Shared development and a permanent staging
website have not been provisioned by this migration adoption.
