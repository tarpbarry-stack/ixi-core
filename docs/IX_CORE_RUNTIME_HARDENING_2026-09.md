# IX-Core runtime hardening — September 2026

Status: source candidate only. This document does not authorize deployment or
production mutation.

## Confirmed regression timeline

### September 6 — synchronous SQLite integrity checks entered `/health`

Commit `32dc5821e793fda3d4258f14a9e211369be00746` introduced the SQLite
store and made routine health execute `PRAGMA quick_check`. The production
driver is synchronous, so the check blocks Node's event loop. A client timing
out does not cancel the server-side check; repeated probes can queue additional
checks behind the first one.

Routine liveness and readiness must be bounded. Deep SQLite integrity belongs
in the backup and controlled release gates, where it remains mandatory.

### September 6 — synchronous Passport lock waiting entered the request path

Commit `14fd39c94827403551e1ecb819fec4aff0df6f35` added a Passport
registry lock that waited for as long as five seconds with `Atomics.wait`.
That protected identity writes, but it also stopped the entire event loop
during lock contention.

The hardened behavior retains exclusive atomic writes and stale-lock recovery,
but active contention now fails immediately with a retryable HTTP 503 error.

### September 9–12 — runtime filesystem and release pressure amplified both

Observed production evidence:

- root storage reached 99% with only 291 MB available;
- a guarded SQLite backup failed with `SQLITE_FULL`;
- `/var/backups` occupied approximately 4.7 GB before operator cleanup;
- the ubuntu runtime user could not write the root-owned Passport directory;
- Passport mutation failed with `PASSPORT_REGISTRY_LOCK_FAILED`;
- PM2 reported `online` while port 4100 was not yet responsive;
- IX-Core had accumulated 871 PM2 restarts.

Disk pressure and incorrect ownership were deployment-boundary failures, not
canonical data defects. The production data census remained 101 Objects, 56
active Objects, and 228 Passports during the documented repair.

## Hardened runtime contract

- `GET /live` proves only that the HTTP process can answer. It never opens or
  scans durable storage.
- `GET /ready` proves that configured MOS storage is reachable and can answer
  bounded metadata queries.
- `GET /health` remains backward compatible but uses the same bounded storage
  check.
- Deep SQLite `quick_check` remains explicit through `health({ deep: true })`
  and the existing controlled backup tooling.
- Passport lock contention never sleeps on the Node event loop.
- A stale Passport lock may be recovered; a current lock fails closed and is
  reported as retryable.

## Release-owner requirements

Before any future deployment, the release owner must independently verify:

1. exact source commit and tree;
2. sufficient disk capacity for both backup and rollback;
3. runtime-user read/write access to Passport and SQLite parent directories;
4. absence of a stale Passport lock;
5. `/live` before `/ready`;
6. deep SQLite and Passport integrity in the controlled release gate;
7. unchanged Object and Passport census;
8. a recoverable, checksummed rollback artifact.

The source repository includes read-only boundary auditing and an explicit,
recoverable debris-quarantine tool. Neither runs automatically.

