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
8. Start IX Core with its updated environment, request `/live`, and then
   request `/ready`. Run deep SQLite integrity verification as a separate
   controlled release gate.
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
- Use the installed `ixi-core-recovery.timer` and `/etc/ixi-recovery.env` for scheduled production recovery. `npm run mos:storage:backup` uses the same complete private recovery helper under the production lock; it requires the explicit `IXI_RECOVERY_BUCKET` and `IXI_RECOVERY_ACCOUNT_ID` configuration. It checks capacity, verifies SQLite plus matching Passports and runtime files, then downloads and hashes the exact uploaded S3 version. Successful runs remove their temporary local copies.
- `node mos/storage/backupSqlite.js` is a local diagnostic export, not full disaster recovery. It atomically replaces one verified `latest-verified.sqlite` copy after integrity checks, retains the prior copy on failure, and refuses concurrent exports or an unrecognized existing destination. It does not delete unrelated historical files or upload to an unverified bucket.
- Alert on `/live` or `/ready` returning 503. Alert separately on a checksum
  or deep-integrity failure from the controlled backup/release gate.
- Treat `MOS_STORAGE_CONFLICT` as HTTP 409 and retry from a fresh canonical
  read; never overwrite it.
- Never run two storage providers against the same live Entity.
