# Resume folder storage: preservation rollout

This change uses `/var/www/ats-data/resumes` on the VPS, bind-mounted at
`/app/uploads/resumes` in every backend release. PostgreSQL keeps a relative
`storage_key`; original names, MIME types, hashes, parsed data and candidate
references remain in the database. The directory is private and has no public
web-server mapping.

## Preservation guarantees

- The SQL migration adds one nullable column. It does not remove or clear data.
- Existing `file_data` values are retained indefinitely by this change.
- Copying checks SHA-256 and size before adding a reference. Existing destination
  conflicts stop the operation; they are never overwritten.
- Upload failures preserve newly created files and records for reconciliation.
  This release does not introduce an orphan cleanup job.
- Configure preservation mode before running deployment backups. It disables
  old-backup pruning. This intentionally increases retained backup storage until
  the owner approves a future retention policy.
- No outside backup, database compaction, old-file cleanup, volume removal or
  data reset is part of this rollout.

## Rollout order

1. Build and verify the backend image containing the storage service, Prisma
   migration and compiled `resume-storage/migrate-resumes.js` entry point.
2. Install the reviewed `deployment/bluegreen/release.py` controller. Preserve
   the previous controller separately for recovery; do not prune old backups.
3. Configure the shared host directory **before** deploying the new backend:

   ```sh
   sudo env RESUME_STORAGE_HOST_DIR=/var/www/ats-data/resumes \
     python3 /var/www/ats-prod/bluegreen/release.py /var/www/ats-prod configure-resume-storage
   ```

   This is idempotent, rejects other host locations or conflicting existing
   configuration, and preserves existing files. The production backend image
   currently runs as root. If its container user changes, review folder ownership
   before deployment; do not make the directory publicly writable.
4. Use the normal reviewed release process to apply the additive migration and
   deploy the backend. The release controller sets `RESUME_STORAGE_DIR` and mounts
   the same private folder for both backend slots. Confirm the mount and write
   permissions before accepting uploads. Production startup verifies that the
   persistent directory is an actual mount and stops if it is missing. The standalone compose configuration
   also requires `RESUME_STORAGE_HOST_DIR` and an already-created directory.
5. In the **new, running backend container**, first run the read-only inventory:

   ```sh
   docker exec BACKEND_CONTAINER node /app/dist/resume-storage/migrate-resumes.js
   ```

   Depending on the Nest build layout, the entry point can instead be
   `/app/dist/src/resume-storage/migrate-resumes.js`; use the file in that image.
6. Copy old originals and set verified references:

   ```sh
   docker exec BACKEND_CONTAINER node /app/dist/resume-storage/migrate-resumes.js --apply --batch-size=10
   ```

   Capture the aggregate report. The tool reports original record and byte totals
   before and after. It only updates `storage_key`, with a condition that the
   source bytes have not changed. A failure leaves source data and copies intact.
   Review failures, then rerun: matching destinations are verified and reused.
7. Run the read-only inventory again. Require zero pending originals, and verify
   representative PDF/DOCX downloads, previews, replacement CVs, website uploads,
   bulk uploads and submission handoffs using authorized test accounts. For new
   uploads, confirm `storage_key` exists and `file_data` is NULL. Verify old
   `file_data` bytes remain. Metadata-only records are not migration failures.

Existing backup archives of `/app/uploads` include the mounted resume folder.
This is still a full archive, so repeated backups can consume substantial space.
Disk-capacity monitoring remains necessary while pruning is disabled.

## Rollback

An older database-only reader can access preserved historical originals but
cannot access new folder-only uploads. Keep this storage-aware reader deployed
during an application rollback, or copy new originals into PostgreSQL using a
separately reviewed recovery operation first. Leave the additive column, host
folder, mount, backups and copied files intact. Do not drop the column, clear
`file_data`, remove the volume, or delete the folder as a rollback step.

## Local development

Set `RESUME_STORAGE_DIR` to an absolute private writable directory, such as the
backend's `uploads/resumes` directory. It is ignored by Git. A missing setting
rejects new file writes instead of silently saving new documents to PostgreSQL.
Legacy database-file reads remain available without that setting.
