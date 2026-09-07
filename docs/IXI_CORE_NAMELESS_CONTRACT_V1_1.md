# IX-Core Nameless Contract v1.1

Status: integration candidate; not approved for production until the release gates below pass.

## Non-negotiable invariants

- One active canonical Object resolves to exactly one permanent Passport.
- Object IDs, current Passport IDs, historical Passport IDs, and typed external aliases are references to the same canonical Object; aliases are never Objects.
- Resolution never creates an Object, Passport, or durable edge.
- Object creation is limited to authenticated Save, authorized upload/import, and governed onboarding/bootstrap boundaries.
- A durable edge adds one fact and never ends an unrelated fact.
- Customer labels are optional data. They do not identify behavior, authority, projection, or security policy.
- Workspace placement, Board, Recall, Return, rendering, and rail projection never create identity.

## Canonical admission

Authenticated endpoint:

`POST /mos/v1/identity/admit`

Request:

```json
{
  "objectId": "object_...",
  "passportId": "IXI...",
  "aliases": [
    {
      "sourceType": "sharetribe-listing",
      "sourceId": "listing-id"
    }
  ]
}
```

At least one reference is required. When multiple references are supplied, all must converge on the same active Object and permanent Passport inside the authenticated Entity.

Success returns canonical `objectId`, `passportId`, `entityId`, aliases, resolution evidence, and the canonical Object. Resolution is read-only.

Failure classes:

| Code | Meaning |
| --- | --- |
| `CANONICAL_IDENTITY_REPAIR_REQUIRED` | Identity exists but the Object/Passport binding is missing, inactive, or inconsistent. |
| `CANONICAL_IDENTITY_CONFLICT` | References resolve to multiple Objects or Passports. Stop; do not guess. |
| `CANONICAL_ALIAS_CONFLICT` | One typed alias is owned by multiple Passports. |
| `CANONICAL_ENTITY_MISMATCH` | The resolved identity crosses the authenticated tenant boundary. |
| `CANONICAL_CREATION_BOUNDARY_REQUIRED` | A non-creation workflow attempted to provision while resolving. |

## Durable rail edge

Endpoint:

`POST /mos/v1/relationships`

Required headers:

- `Idempotency-Key: <commandId>`

Request:

```json
{
  "commandId": "uuid-or-stable-command-id",
  "sourceObjectId": "object_projected_into_the_rail",
  "sourcePassportId": "IXI...",
  "targetObjectId": "object_that_owns_the_rail",
  "targetPassportId": "IXI...",
  "behaviorId": "aos.rail-membership.v1",
  "definitionId": null,
  "relationshipLabel": null,
  "orderKey": "000100"
}
```

The customer label may be absent or renamed without changing edge identity. The stable identity of a technical edge is tenant + source Object + target Object + behavior ID + optional tenant definition ID.

Supported behavior IDs:

| Behavior ID | Projection | Cycle policy | Cardinality |
| --- | --- | --- | --- |
| `aos.rail-membership.v1` | Source appears as a preview in target's rail | Structural cycles rejected | many-to-many |
| `aos.neutral-connection.v1` | No automatic rail projection | Cycles allowed; traversal bounded | many-to-many |

Environment hydration returns `railProjections`, keyed by rail-owner Object ID. Members are canonical Object references; they are not copies and do not create new Passports.

Rail reorder uses `POST /mos/v1/relationships/:relationshipId/order` with matching `expectedRevision` and `If-Match`, an idempotency key, and a new stable `orderKey`. It updates the existing edge; it never deletes and recreates membership.

## Authority

Durable edge creation and termination use separate governed actions:

- `aos.relationship.create`
- `aos.relationship.end`
- `aos.relationship.order`

They no longer borrow generic `aos.move` semantics. Object capability fields are presentation/technical metadata and never actor authority. Environment hydration must not upgrade capabilities or mutate Objects.

## Retired or isolated paths

| Path or behavior | State |
| --- | --- |
| Freight resolution provisioning from `source.verified` | Prohibited; fails closed. |
| `POST /passport/ensure` | Retired; generic Passport birth is not governed. |
| Public Passport registry enumeration | Forbidden. |
| Public Passport deletion/by-source deletion | Retired. Permanent identity is not disposal state. |
| `POST /mos/v1/containers/:id/place` | Legacy-only; disabled unless `IXI_MOS_LEGACY_CONTAINMENT_WRITES=true`. |
| `POST /mos/v1/objects/:id/remove-from-container` | Legacy-only; disabled by the same flag. |
| `directContainerId` | Preserved only as migration evidence; not new graph truth. |

## Creation-path classification

| Path | Classification | Rule |
| --- | --- | --- |
| `POST /mos/v1/objects` | Authorized explicit Save | Routes through canonical Object+Passport provisioning and requires idempotency. |
| `POST /mos/v1/objects/provision` | Authorized explicit creation service | Must use authenticated tenant and actor context. |
| `POST /mos/v1/aos/machines/sharetribe-listing` | Authorized upload/listing admission | May adopt one proven canonical Object; multiple matches stop. |
| Import execution service | Authorized import | Creates only from explicit staged import work. |
| Commercial onboarding/system-index bootstrap | Governed bootstrap | May establish missing birth identity idempotently. |
| Provisioning recovery | Transitional repair | May complete one recorded incomplete birth; never starts a second birth. |
| Freight, Financial, relationship, Board, Recall, Return, rendering | Prohibited creation contexts | Resolve existing identity or fail. |

## Release gates

1. `IXI_MOS_INTERNAL_AUTH_ENFORCE=true` is verified with the tested frontend signer; compatibility mode is not production authority.
2. Frontend uses canonical admission and `aos.rail-membership.v1`; no hardcoded `contains` dependency remains.
3. Frontend no longer calls the retired generic Passport or legacy containment write endpoints.
4. Read-only production census reports zero critical identity conflicts and inventories every legacy direct-parent link.
5. Production SQLite and Passport backups are checksummed and rollback-tested.
6. The complete test suite passes on the exact IX-Core commit paired with the exact frontend commit.
7. A production clone proves the Wichita Falls/ripper scenario with unchanged Object and Passport counts.

## Required commercial proof

- Begin with the existing ripper Object and its existing Passport.
- Create one rail edge to Wichita Falls.
- Preserve the Equipment projection/reference and all unrelated edges.
- Confirm the ripper appears as one operating card and multiple lightweight previews.
- Confirm Object count and Passport count do not change.
- Rename customer-facing labels and confirm behavior, authority, edge identity, and audit lineage do not change.
- Reject structural cycles; allow and safely traverse permitted neutral cycles.
- End only the selected edge using revision and idempotency controls.
