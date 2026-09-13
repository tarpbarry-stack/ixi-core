# AOS stabilization release — September 13, 2026

Owner: this stabilization task. The user paused competing agents and authorized implementation and release.
Status: frontend release merged and deployed; backend promotion blocked by AWS administrator setup.
The first deployment stopped before any runtime installation because the GitHub deployment user
does not have s3:CreateBucket. Backend completion still requires the evidence below.

## Product contracts retained

- One canonical Object and one permanent Passport; listing and AOS bindings can share that Passport.
- Resolution and presentation never create identities.
- Durable relationships are separate from session placement, session origin, and Return snapshots.
- Board, Recall, Return, retries and refresh must preserve canonical Objects, Passports and durable edges.
- Financial discovery recognizes a verified AOS source binding and still enforces authenticated scope.
- Projection kind hints are display-only. Conflicting container hints remain neutral and array order cannot decide them.
- SOLD means collected funds; Settlement means disbursement. This release does not redefine that lifecycle.

## Reproduced failures addressed

1. A stale frontend session restored obsolete placements and attempted to undo a rejected command.
2. Financial rejected a reused listing Passport despite its valid AOS-object binding.
3. Conflicting container projection hints used last-array-entry wins.
4. Every idempotency update archived another complete growing command-result map.
5. Feature deployments left storage and Passport hardening in GitHub but absent from AWS.
6. Current recoverability and scheduled backups were not established.
7. IAM simulation found the runtime role lacked UpdateItem used by atomic Treasury balance updates.

## Candidate changes

Session recovery lives in the paired frontend branch. Real signed HTTP/SQLite tests cover two clients,
queued gestures, lost responses, refused Recall, process restart and Return.
Financial tests exercise the real listing-to-AOS provisioning path without creating a second Passport.
Idempotency records/results remain durable; existing history remains untouched. New full-map
idempotency history copies stop. Per-command indexed storage is a future scaling decision.

The complete deployment script stages and tests an immutable commit, verifies all manifest-listed
runtime sources, verifies private versioned backup storage, exercises a Treasury authorization probe
whose contradictory condition prevents every possible write, stops writers for a pre-release recovery
set, uploads and downloads that verified set, installs every source file in the manifest and dependencies,
and verifies health, protected routes, canonical census and relationships. A source rollback restores
only candidate-managed source files, preserving runtime data.

Hourly recovery takes a SQLite snapshot and requires a stable Passport registry during capture. It
validates collection checksums, canonical Passport bindings, restored JSON and SQLite files, then verifies
the uploaded S3 version by downloading and hashing it. A failed capture is not published as a good backup.
Financial, Freight and Ticket DynamoDB tables require 35-day point-in-time recovery.

Treasury's additional IAM permission is restricted to UpdateItem on the existing Financial table inside
TransactWriteItems. No frontend user permissions are widened.
AWS reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html

## One-time AWS setup and ordinary deployments

An authorized AWS administrator runs `ops/configure-runtime-recovery.sh` in account 459212966383,
region us-east-2. It creates the dedicated private versioned recovery bucket, enables its encryption
and retention, grants the existing runtime role only recovery access and the required conditional
Treasury update, and enables 35-day recovery on the three existing business tables. It does not
grant the GitHub deployment user S3 or IAM administration, and does not write business records.

Normal GitHub deployments verify the account and instance, then use their existing SSM access.
The runtime role checks private versioned storage, actual DynamoDB recovery configuration, and the
no-write Treasury authorization probe before stopping writers. Missing setup blocks installation.
Git operations in the staged release run as the checkout owner, while protected source installation
and recovery capture run as root; Git ownership safeguards remain enabled.

## Required release evidence

- Exact frontend and backend commit IDs and passing required paired gate; no skipped paired tests.
- Private versioned S3 recovery receipt with download checksum and restored census.
- DynamoDB recovery enabled and no-write atomic Treasury permission probe passed.
- Complete installed source manifest passes; old partial overlays are retired.
- /live and /ready pass bounded probes; unsigned protected routes remain denied.
- Object/Passport census and Object/relationship collection checksums unchanged across deployment.
- Scheduled online recovery completes successfully and its timer is active.
- Authenticated AOS movement/Return and TRAN$ACT 544K history/projection checked in the deployed UI.

## Explicit limits

Passing these gates establishes this stabilization release, not certification of every accounting
balance, all commercial workflows, public-launch security, or future workload capacity.
Public SSH/4100 rules require origin-path verification before removal; closing a port blindly can
break the existing frontend-to-core route. Existing idempotency history is preserved; no production
compaction, identity recreation, database migration or business-record cleanup is part of this release.
