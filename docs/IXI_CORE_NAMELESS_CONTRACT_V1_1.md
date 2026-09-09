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

Success returns canonical `objectId`, `passportId`, `entityId`, aliases, resolution evidence, and the canonical Object. The alias set is the deduplicated union of authoritative Passport sources and released Object identity/source-binding shapes. A historical listing alias stored on the Object therefore remains usable even when an older Passport record did not duplicate that source. Browser-supplied aliases are never adopted merely because they were supplied. Resolution is read-only.

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

During the migration window, environment hydration may also return a passive
legacy projection only when two independent stored facts agree: an active
legacy edge points from the member Object to the rail owner, and that same
active member Object's `directContainerId` names the same owner. The member is
marked `legacy-direct-container-corroborated.v1` and `readOnly`. This bridge
does not translate, create, end, reorder, or relabel an edge. An equivalent
governed `aos.rail-membership.v1` edge takes precedence and deduplicates the
legacy preview. Uncorroborated legacy evidence remains quarantined.

Rail reorder uses `POST /mos/v1/relationships/:relationshipId/order` with matching `expectedRevision` and `If-Match`, an idempotency key, and a new stable `orderKey`. It updates the existing edge; it never deletes and recreates membership.

## Authority

Durable edge creation and termination use separate governed actions:

- `aos.relationship.create`
- `aos.relationship.end`
- `aos.relationship.order`

They no longer borrow generic `aos.move` semantics. Object capability fields are presentation/technical metadata and never actor authority. Environment hydration must not upgrade capabilities or mutate Objects.

### Authenticated principal binding

The HMAC envelope authenticates `principalId`, `entityId`, request target, body,
timestamp, and request ID. Authentication does not itself grant authority.
After cryptographic verification IX-Core resolves exactly one active membership
for that principal and Entity, verifies its active account and tenant, and only
then sets `req.ixiAuthorityPrincipal`.

Missing, inactive, duplicate, cross-Entity, and cross-tenant memberships fail
closed. Membership `directDenies` are evaluated before grants and `*` deny wins.
The governed owner membership may carry a server-registered `*` grant; it is not
inferred from a browser role, object type, Passport, card number, label, or
presentation capability. With `IXI_MOS_INTERNAL_AUTH_ENFORCE=true`, missing
authority evidence is a denial and compatibility-allow is unavailable.

The browser must never send authority as truth. Fields such as `actorId`,
`entityId`, `permissions`, `roles`, `capabilities`, `canContain`, and
`actorAuthority` are ignored or replaced at the trust boundary.

### Effective object authority envelope

Every canonical Object returned by admission, environment hydration, Object
discovery, or Object read contains a non-persistent, server-calculated envelope:

```json
{
  "actorAuthority": {
    "canCreateChild": true,
    "canCreateObject": true,
    "canRelate": true,
    "canEndRelationship": true,
    "canOrderRelationship": true,
    "canEdit": true,
    "canTransact": true,
    "canOpenConsole": true,
    "canHide": true,
    "canArchive": true,
    "canDelete": false,
    "canViewFinancial": true,
    "canViewFinancialInformation": true
  },
  "authorityDecisions": {
    "aos.delete": {
      "allowed": false,
      "decision": "deny",
      "reason": "principal-direct-deny",
      "capability": "aos.delete",
      "objectId": "object_...",
      "passportId": "IXI..."
    }
  }
}
```

This envelope is display guidance only. Each server mutation re-evaluates its
registered capability. The registered capabilities include `aos.create`,
`aos.import`, `aos.provision.recover`, `aos.edit`, `aos.relationship.create`,
`aos.relationship.end`, `aos.relationship.order`, `aos.console.open`,
`aos.workspace.session.open`, `aos.workspace.placement.write`,
`aos.workspace.shared`, `aos.archive`, `aos.delete`, `transact.open`, and
`transact.financial-reporting.view`.

## Authenticated session placement

Session placement is workspace state, not graph state. It cannot create an
Object, issue a Passport, create/end an edge, or write `directContainerId`.

Open or resume a scope:

`POST /mos/v1/aos/workspace-sessions`

```json
{
  "commandId": "stable-command-id",
  "workspaceId": "aos-work",
  "placementScope": "personal",
  "sharedScopeId": null,
  "ttlMs": 28800000
}
```

`Idempotency-Key` must equal `commandId`. IX-Core supplies `sessionId`,
`startedAt`, `expiresAt`, and revision `0`. An unexpired session with the exact
tenant + Entity + workspace + placement scope + owner/shared-scope key resumes.
Multiple active matches fail as corrupt scope state.

Read:

`GET /mos/v1/aos/workspace-sessions/:sessionId?placementScope=personal`

Apply one operation:

`POST /mos/v1/aos/workspace-sessions/:sessionId/commands`

Required headers are `Idempotency-Key: <commandId>` and
`If-Match: <expectedRevision>`.

```json
{
  "commandId": "stable-command-id",
  "expectedRevision": 4,
  "placementScope": "personal",
  "commandType": "object.move",
  "payload": {
    "objectId": "object_...",
    "surfaceId": "object_rail_owner_or_board_surface",
    "visualOrder": 2,
    "operatingState": "operating"
  }
}
```

Supported operations are `object.admit`, `object.move`, `object.recall`,
`object.snapshot.capture`, `object.undo`, `surface.reorder`, and `summon.set`.
`object.admit` records immutable `sessionOrigin`; recall always uses it.
`returnSnapshot` is tied to one `operationId`, is used only by `object.undo`, and
is consumed by that undo. A second active placement for the same canonical
Object in one scope is rejected. Listing IDs and Passport IDs cannot be
placement keys.

End:

`POST /mos/v1/aos/workspace-sessions/:sessionId/end`

End requires matching idempotency and revision headers and clears temporary
return snapshots. Shared scopes additionally require `aos.workspace.shared`.
Every write records authenticated actor and command evidence in the event log.
Expired, stale-revision, cross-tenant, foreign-personal, and unauthorized-shared
access fails closed.

## Relationship identity evidence

Relationship create, read, end, order, graph, and environment hydration return
authoritative endpoint evidence without persisting browser claims:

```json
{
  "relationshipId": "relationship_...",
  "behaviorId": "aos.rail-membership.v1",
  "definitionId": "tenant-definition-or-null",
  "orderKey": "000100",
  "revision": 1,
  "status": "active",
  "sourceObjectId": "object_member",
  "sourcePassportId": "IXI_MEMBER",
  "targetObjectId": "object_rail_owner",
  "targetPassportId": "IXI_OWNER",
  "sourceIdentity": {
    "objectId": "object_member",
    "passportId": "IXI_MEMBER",
    "entityId": "entity_..."
  },
  "targetIdentity": {
    "objectId": "object_rail_owner",
    "passportId": "IXI_OWNER",
    "entityId": "entity_..."
  }
}
```

Supplied Object/Passport mismatches are rejected. Reordering advances revision
and preserves `relationshipId`. Rail projections contain both the member
Passport and rail-owner Passport, plus relationship ID, behavior ID, definition
ID, order key, revision, and status. Customer labels remain optional data.

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
| `POST /mos/v1/objects/provision` | Authorized explicit creation service | Requires `aos.create`, signed tenant/actor context, and matching body/header command IDs. |
| `POST /mos/v1/aos/machines/sharetribe-listing` | Authorized Post Free/upload/URL import | Requires `aos.create`, an authenticated owned listing, and `Idempotency-Key`. It may adopt one proven canonical Object; multiple matches stop. |
| `POST /mos/v1/imports/jobs` and execute routes | Authorized bulk import | Requires `aos.import`; execution also requires `aos.create`. Staged row provisioning keys and request command IDs are idempotent. |
| `POST /mos/v1/aos/onboarding/bootstrap` | Governed bootstrap | Requires a signed principal. It uses a deterministic principal bootstrap command when no caller command is supplied. |
| `POST /mos/v1/objects/provision/:commandId/recover` | Recorded provisioning recovery | Requires `aos.provision.recover`; may complete only one existing failed birth and never starts a second birth. |
| Freight, Financial, relationship, Board, Recall, Return, rendering | Prohibited creation contexts | Resolve existing identity or fail. |

### Exact frontend creation integration

- `+ -> Save`: send `commandId` in JSON and the same value in
  `Idempotency-Key` to `/objects` or `/objects/provision`.
- Post Free, authenticated upload, and URL Import: send the authenticated owned
  listing to `/aos/machines/sharetribe-listing` with a stable
  `Idempotency-Key`. New clients should also send the same `commandId` in the
  body and one of `post-free`, `upload`, or `url-import` as
  `creationBoundary`. The currently tested Agent 1 gateway shape is supported
  as `authenticated-listing-admission.v1` when the explicit field is absent.
- Bulk import: create the job with a matching body/header command ID, stage
  rows, then execute a row or batch with another matching body/header command
  ID. The server replaces Entity and actor values from the signed principal.
- Onboarding: call the bootstrap endpoint through the signed internal client.
  Browser `ownerUserId` is never authority.
- Never call `/passport/ensure`. Never call a Passport deletion endpoint.

## Permanent Passport disposition

Permanent Passport deletion is prohibited both at HTTP and registry service
layers. `DELETE /passport/:passportId` and
`DELETE /passport/by-source/:sourceType/:sourceId` return HTTP 410 doctrine
errors and do not mutate the registry. Disposition may archive presentation,
retire a listing, record disposal state, or end explicitly selected edges. It
cannot delete, recycle, or silently replace the permanent Passport.

## Exact frontend integration requirements

1. Use only `response.identity` plus `response.object` from canonical admission;
   flattened or browser-invented identity evidence is invalid.
2. Key the operating registry, placement entries, and commands by canonical
   `objectId`; Passport/listing/historical IDs are aliases.
3. Treat `actorAuthority` as UI guidance and surface server denials unchanged.
4. Use `aos.rail-membership.v1`, both endpoint Object/Passport pairs, stable
   command IDs, and canonical relationship readback.
5. Consume rail projections as lightweight references. One Object may appear
   in many rails but has one operating placement per session scope.
6. Persist Board, Recall, Return, order, summon, and operating-card state only
   through the session-placement API. Do not restore whole stale layouts after
   an asynchronous edge command.
7. Do not expose generic Passport ensure, permanent deletion, legacy container
   placement, or `directContainerId` write paths.

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
