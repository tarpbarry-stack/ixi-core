# IXI Tenant Census Runbook

The tenant census is a read-only inspection of the canonical MOS SQLite database,
the Passport registry, and any legacy JSON files beside the database. It does not
load MOS services and cannot initialize or rewrite collections.

## Production command

Run from the IX-Core release directory while IX-Core remains online:

```bash
node ops/audit-tenant-census.js \
  --database /var/lib/ixi-core/mos/ixi-aos.sqlite \
  --passports /var/www/ix-core/passport/passports.json \
  --data-root /var/lib/ixi-core/mos \
  --protected-entity entity_4d78e9fb-92e4-4cc2-a8cb-1a2f19e097d0 \
  > /var/backups/ixi-core-releases/tenant-census.json
```

The command exits with:

- `0` when no critical finding exists.
- `2` when the report completed but found one or more critical integrity defects.
- `1` when the census itself could not run.

An exit code of `2` is evidence for investigation. It is not authorization to
delete or rewrite data.

## Required purge gate

No cleanup may proceed until all of the following are true:

1. SQLite integrity and every collection checksum are valid.
2. The protected Entity is classified `KEEP_PROTECTED`.
3. Every active protected Object resolves to exactly one Passport.
4. No active relationship or direct containment crosses an Entity boundary.
5. Every non-protected Entity has been explicitly classified by a human-reviewed
   deletion manifest.
6. The manifest succeeds against cloned SQLite and Passport files.
7. Post-cleanup protected records compare byte-for-byte with their pre-cleanup
   snapshot.

Legacy JSON files are inventoried as inactive while the SQLite provider is active.
Their presence alone is not evidence that production code can reach them.
