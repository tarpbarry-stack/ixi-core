# IXI AOS Creation Integrity Control Plane

## Purpose

This package verifies the permanent birth invariant across every AOS creation channel without introducing another Object or Passport system.

Creation channels remain manual AOS SAVE, Object Studio launch/save, Bulk / Excel Import execution, and trusted API / Chat commit. All of them converge on the existing IX-Core permanent provisioning boundary.

## Invariants

For every permanent new-contract AOS Object:

1. one permanent `objectId` exists;
2. the Object carries one canonical `ixi-passport` identity;
3. that Passport record exists;
4. AOS Passport `sourceType` is `aos-object` and `sourceId` resolves back to the Object;
5. one Passport cannot belong to multiple Objects;
6. one Object cannot have multiple AOS source Passports;
7. one provisioning command/idempotency key cannot resolve to conflicting Object/Passport births;
8. reconciliation is Entity-scoped;
9. after `IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT`, every new AOS Passport must persist the same `entityId` as its Object;
10. the integrity system is read-only and never silently repairs identity truth.

Historical Passport records created before the tenant-identity enforcement epoch may omit `entityId`. That compatibility boundary is timestamp based, not inferred from names, categories or business vocabulary.

## HTTP control plane

Mount `creationIntegrityRouter` below the existing HMAC authentication and tenant-boundary middleware. The authenticated server context supplies the Entity; the browser never chooses a trusted Entity ID.

`GET /mos/v1/aos/creation-integrity/health` returns compact status. Healthy returns HTTP 200. Attention/failed returns HTTP 409.

`GET /mos/v1/aos/creation-integrity/report` returns the full finding set.

## Required live data adapters

`loadObjects({ entityId })` returns only canonical permanent new-contract MOS Objects for that Entity. Browser drafts and legacy pre-provisioning Objects are excluded.

`loadPassports({ entityId })` returns AOS Passport records whose canonical source Object is in that authenticated Entity. A Passport with an incorrect `entityId` must remain visible when its `sourceId` links to an in-scope Object so reconciliation can report the mismatch rather than hide it.

`loadProvisioningRecords({ entityId })` returns durable provisioning/idempotency records for the permanent provisioning command type and Entity.

## Automatic runner

`creationIntegrityRunner.js` executes reconciliation tenant by tenant. It is intentionally sequential in v1 to avoid burst pressure on shared identity stores and preserve deterministic incident ordering.

The runner persists per-Entity state and fingerprints the complete finding set. It emits:

- `incident` when an Entity first becomes unhealthy or its defect fingerprint changes;
- no duplicate alert when the same unresolved finding set repeats;
- `recovery` when an unhealthy Entity returns to healthy;
- a retry on the next run when alert delivery itself fails.

`creationIntegrityWorker.js` is the scheduled process entrypoint. It requires a live adapter through `IXI_AOS_CREATION_INTEGRITY_ADAPTER` exporting:

- `listEntityIds()`
- `loadObjects({ entityId })`
- `loadPassports({ entityId })`
- `loadProvisioningRecords({ entityId })`
- optional `emitAlert(alert)`

The worker always maintains a local durable JSONL incident spool before an optional external alert sink. Default files are:

- `data/mos/creation-integrity-state.json`
- `data/mos/creation-integrity-alerts.jsonl`

Exit semantics are operationally meaningful:

- `0`: all reconciliations healthy;
- `1`: runner/infrastructure execution failure;
- `2`: reconciliation completed but one or more Entities are unhealthy.

That permits systemd/PM2/CloudWatch or another operations layer to distinguish a broken worker from a detected integrity incident.

## Critical finding vocabulary

- `DUPLICATE_OBJECT_ID`
- `DUPLICATE_PASSPORT_ID`
- `OBJECT_PASSPORT_MISSING`
- `OBJECT_PASSPORT_RECORD_MISSING`
- `ORPHAN_AOS_PASSPORT`
- `PASSPORT_LINKED_TO_MULTIPLE_OBJECTS`
- `OBJECT_HAS_MULTIPLE_SOURCE_PASSPORTS`
- `OBJECT_PASSPORT_SOURCE_MISMATCH`
- `PASSPORT_OBJECT_LINK_MISMATCH`
- `PASSPORT_ENTITY_ID_MISSING`
- `PASSPORT_ENTITY_ID_MISMATCH`
- `PROVISIONING_COMMAND_CONFLICT`

A missing provisioning command identifier is `high` severity because identity may still be correct while provenance is incomplete.

## Operating doctrine

Do not auto-delete, auto-relink, auto-create or silently backfill Passports from this service. A reconciliation defect is evidence requiring an explicit remediation command with audit history. Silent repair destroys forensic value.

Do not infer customer business meaning from Object names, container names, labels, categories, card headers or definition labels. Integrity is exclusively technical identity and provenance.

## Production rollout

1. Copy `integrity/` into `/var/www/ix-core/integrity/`.
2. Implement the live HTTP and worker adapters over canonical MOS Object, Passport and provisioning stores.
3. Mount the router below HMAC authentication + tenant boundary.
4. Set the Passport tenant enforcement epoch.
5. Run all service + runner tests.
6. Prove signed HTTP health/report for multiple real tenants.
7. Run the worker once manually and inspect state/spool output.
8. Schedule the worker at the chosen operations cadence.
9. Attach an external alert sink only after the durable local spool is proven.
10. Resolve every critical finding through an explicit auditable remediation path.