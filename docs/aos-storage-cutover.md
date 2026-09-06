# AOS storage cutover runbook

## Decision

Canonical MOS collections can run through the transactional SQLite provider.
Legacy JSON remains available only as an explicit compatibility provider and
as the source of the first migration. The provider never falls back from
SQLite to JSON after cutover.

This cutover is designed for the current single-instance IX Core deployment.
SQLite removes raw-file corruption, supplies WAL concurrency, checksums,
optimistic version conflicts and retained collection history. Horizontal
multi-instance IX Core remains a separate DynamoDB/Aurora migration gate.

## Required environment

```text
IXI_MOS_DATA_ROOT=/var/lib/ixi-core/mos
IXI_MOS_LEGACY_JSON_ROOT=/var/www/ix-core/data/mos
IXI_MOS_SQLITE_PATH=/var/lib/ixi-core/mos/ixi-aos.sqlite
IXI_MOS_STORAGE_PROVIDER=sqlite
```

Use a durable encrypted EBS volume for `/var/lib/ixi-core`. Do not place the
database in a release directory. The runtime user needs read/write access to
the directory and database. Use Node 24 with the pinned `better-sqlite3`
production driver. Do not substitute Node's release-candidate `node:sqlite`
module in production.

## Controlled cutover

1. Record the current release SHA and health response.
2. Confirm `IXI_MOS_LEGACY_JSON_ROOT` contains the current MOS JSON files.
3. Run the dry-run while IX Core is online:

   ```bash
   node mos/storage/migrateLegacyJson.js
   ```

4. Enter a short maintenance window and stop IX Core so JSON cannot change
   between migration and provider activation.
5. Export `IXI_MOS_DATA_ROOT` and `IXI_MOS_SQLITE_PATH`, then run:

   ```bash
   npm run mos:storage:migrate
   npm run mos:storage:verify
   ```

6. Preserve the reported `backupPath`. Do not delete or edit the legacy JSON.
7. Set `IXI_MOS_STORAGE_PROVIDER=sqlite` in the durable PM2 environment.
8. Start IX Core with its updated environment and request `/health`.
9. Require all of the following before ending maintenance:

   - HTTP 200
   - `ok: true`
   - `mosStorage.provider: "sqlite"`
   - `mosStorage.integrity: "ok"`
   - nonzero collection and migration counts when legacy data existed
10. Perform read-only AOS checks, then one controlled create/read/update cycle.

## Rollback boundary

Before the first SQLite-backed write, rollback is: stop IX Core, restore the
prior provider setting, and restart against the untouched JSON source.

After any SQLite-backed write, do not switch back to JSON; doing so would lose
newer records. Keep IX Core stopped and recover from the SQLite database and
its retained history, or execute a separately reviewed reverse export.

## Operational controls

- Snapshot the encrypted EBS volume on a schedule.
- Set `IXI_MOS_BACKUP_S3_BUCKET` to a versioned, encrypted bucket and schedule
  `npm run mos:storage:backup`; the command verifies both source and backup,
  records a SHA-256 checksum, and uploads the verified copy to S3.
- Alert on `/health` returning 503, checksum failure or integrity failure.
- Treat `MOS_STORAGE_CONFLICT` as HTTP 409 and retry from a fresh canonical
  read; never overwrite it.
- Never run two storage providers against the same live Entity.
