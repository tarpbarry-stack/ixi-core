# IXI Workforce System Access v1

## Purpose

System Access is the owner-controlled authorization face attached to every
canonical AOS Person. It connects a verified Sharetribe login to an existing
Person Object and permanent Passport, then projects explicit application,
machine, Sales Desk, Calendar, TRAN$ACT, and Financial authority into the
person's MOS membership.

## Non-negotiable invariants

- The Entity owner always retains carte-blanche authority. Owner access cannot
  be reduced, suspended, reassigned, or replaced through System Access.
- System Access never creates, renames, moves, reparents, merges, or deletes an
  AOS Object, Passport, relationship, System Index, or customer definition.
- A login invitation can bind only to the exact active Person Object and
  Passport selected by the owner.
- Customer labels, container names, Person names, role labels, and display
  language never determine authorization.
- New and existing Person cards receive the same safe virtual default: no
  login, no private-machine access, and no Financial role.
- Authority is derived again inside IX-Core from the signed principal and
  durable membership. Browser-supplied roles, emails, Entity IDs, and access
  claims are not trusted.

## Durable records

Profiles, invitations, revisions, and audit rows live in the existing MOS
SQLite database and therefore use the established verified backup and recovery
path. Invitations store only a token hash. Their secret is reproducible only
from the server secret and stable owner command ID so a lost response can be
retried without saving a raw token.

Profile writes use optimistic revision control. An identical retry resumes the
already-committed revision and repairs an interrupted membership projection.
A materially different stale write fails with a revision conflict.

## Machine scope

Machine visibility is based on canonical Passport identity and stable semantic
Object types, never on where a card is displayed or what a customer named a
container.

- `none`: no governed asset Object is discoverable.
- `selected`: only the selected canonical Passport IDs are discoverable.
- `all`: all current and future governed asset Objects in the Entity are
  discoverable.

Direct deny and cross-Entity checks still take precedence. Financial Passport
scope is built from the same Authority-filtered estate.

## Invitation lifecycle

1. The owner saves and enables the Person's profile.
2. IX-Core creates a seven-day, verified-email invitation.
3. The recipient signs in through the existing Sharetribe login.
4. The frontend gateway supplies the verified session email; browser claims are
   discarded.
5. IX-Core creates exactly one membership bound to the selected Person Object,
   Person Passport, Entity, account, and tenant.
6. Revoke, expiration, wrong email, wrong Entity, duplicate Person, and
   duplicate principal all fail closed.

## Change boundary for future agents

Changes to System Access may extend its explicit profile schema and membership
projection. They must not modify AOS recursive membership, relationship
behavior, Object/Passport admission, customer naming, card movement, or System
Index semantics. Any new scoped resource type must be identified by a stable
server-owned semantic type or definition ID and covered by cross-Entity,
rename, retry, owner-lockout, and identity-census tests.
