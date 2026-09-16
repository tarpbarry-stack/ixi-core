# IXI AOS Creation Integrity Control Plane

## Purpose

This package verifies the permanent birth invariant across every AOS creation channel without introducing another object or Passport system.

Creation channels remain:

- manual AOS SAVE
- Object Studio launch/save
- Bulk / Excel Import Job execution
- trusted API / Chat commit

All of them must converge on the existing IX-Core permanent provisioning boundary.

## Invariants

For every permanent AOS Object:

1. exactly one permanent `objectId` exists;
2. the Object carries exactly one canonical `ixi-passport` identity;
3. that Passport record exists;
4. that Passport's `sourceType` is `aos-object` and `sourceId` resolves back to that Object when the Passport is an AOS-born Passport;
5. one Passport cannot belong to multiple Objects;
6. one Object cannot have multiple AOS source Passports;
7. one provisioning command/idempotency key cannot resolve to different Object/Passport births;
8. reconciliation is entity-scoped and must never leak another customer's records;
9. the integrity service is read-only: it reports defects and does not silently repair identity truth.

## Live `/var/www/ix-core` adapter

The canonical adapter is `mos/integrity/liveCreationIntegrityAdapter.js` in the complete `ixi-core` runtime. It is already mounted through the authenticated MOS router. Release it through the paired complete-runtime workflow; the old `live/` overlays are retired.

```js
const {
  createCreationIntegrityRouter
} = require("./integrity/creationIntegrityRouter");

const integrityRouter = createCreationIntegrityRouter({
  resolveActor: async req => ({
    entityId: req.ixiRequestContext?.entityId,
    principalId: req.ixiRequestContext?.principalId
  }),

  loadObjects: async ({ entityId }) =>
    listObjectsForEntity(entityId),

  loadPassports: async ({ entityId }) =>
    listAosPassportsForEntity(entityId),

  loadProvisioningRecords: async ({ entityId }) =>
    listProvisioningLedgerForEntity(entityId)
});

router.use(
  "/aos/creation-integrity",
  integrityRouter
);
```

Mount it **below** the existing internal HMAC authentication and tenant-boundary middleware. The browser must never choose a trusted Entity ID for this report.

## Required live adapter semantics

### `loadObjects({ entityId })`

Return permanent new-contract Objects and Objects reached by persisted AOS Passport bindings for the authenticated Entity. Include retained archived/soft-deleted records as identity evidence; these cannot count as a second active owner. Exclude unbound legacy records and browser drafts.

### `loadPassports({ entityId })`

Return Passports referenced by the scoped Objects or their AOS bindings, including reused Sharetribe Passports whose AOS binding is in `sources`. Check every primary and secondary AOS source. Wrong-tenant and broken binding evidence must remain visible. A retained tombstone is not a missing Object, and real missing source IDs still fail.

### `loadProvisioningRecords({ entityId })`

Return the durable provisioning ledger records that preserve command/idempotency identity and resulting Object/Passport identity. This is provenance evidence, not a second ledger.

## Endpoints

`GET /mos/v1/aos/creation-integrity/health`

Returns a compact status and counts. `healthy` returns HTTP 200. `attention` or `failed` returns HTTP 409 so monitoring can alert.

`GET /mos/v1/aos/creation-integrity/report`

Returns the full finding set. A failed integrity report returns HTTP 409.

## Finding vocabulary

Critical findings include:

- `DUPLICATE_OBJECT_ID`
- `DUPLICATE_PASSPORT_ID`
- `OBJECT_PASSPORT_MISSING`
- `OBJECT_PASSPORT_RECORD_MISSING`
- `ORPHAN_AOS_PASSPORT`
- `PASSPORT_LINKED_TO_MULTIPLE_OBJECTS`
- `OBJECT_HAS_MULTIPLE_SOURCE_PASSPORTS`
- `OBJECT_PASSPORT_SOURCE_MISMATCH`
- `PASSPORT_OBJECT_LINK_MISMATCH`
- `PROVISIONING_COMMAND_CONFLICT`

A missing provisioning command identifier is `high` severity because identity may still be correct while provenance is incomplete.

## Operating doctrine

Do not auto-delete, auto-relink or auto-create Passports from this service. A reconciliation defect is evidence requiring a controlled remediation command with audit history. Silent repair destroys forensic value.

Do not infer customer business meaning from object names, container names, labels, categories, card headers, or definition labels. Integrity is about technical identity and provenance only.

## Production rollout

1. Run `npm test`, including integrity and maintenance safety tests.
2. Pin the exact backend commit in the frontend's `config/ixi-core-release.json` and pass `scripts/verify-aos-stabilization.mjs` against that checkout.
3. Use `deploy-ixi-core-production.yml` to install the complete verified source manifest after private recovery and capacity checks.
4. Verify the installed source, unchanged canonical data, bounded health probes and the scheduled integrity report.
5. Complete the required authenticated AOS/TRAN$ACT browser gate before claiming deployed business-flow verification.

Never copy feature-specific files into a running release. `ops/deploy-live-aos-integrity.sh` is retired.
