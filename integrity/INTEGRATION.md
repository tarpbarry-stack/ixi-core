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

The GitHub `ixi-core` repository is not the complete running MOS tree. Mount this package into the live service using adapters over the canonical live stores/services.

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

Return the canonical permanent MOS Objects for only the authenticated Entity. Do not return browser drafts.

### `loadPassports({ entityId })`

Return Passport records associated with the authenticated Entity. Legacy Sharetribe Passports may be present; the reconciler only applies orphan-source checks when `sourceType === "aos-object"`.

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

1. Copy `integrity/` into `/var/www/ix-core/integrity/`.
2. Implement the three live adapters using the existing MOS Object, Passport and provisioning-ledger services.
3. Mount the router below HMAC authentication + tenant boundary.
4. Run `node --test integrity/creationIntegrityService.test.js`.
5. Restart IX-Core on port 4100.
6. Call `/mos/v1/aos/creation-integrity/health` through the authenticated signed gateway.
7. Resolve every critical finding before treating the tenant as integrity-green.
8. Schedule reconciliation in operations/monitoring after the live route is proven.
