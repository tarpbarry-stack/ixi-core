# Sales Desk V2

Sales Desk now connects deals, customers, follow-ups, buyer presentation snapshots, and existing financial records. Sales stages remain CRM workflow; they do not post accounting entries, mark inventory sold, or settle accounts.

## Access

Every request resolves the signed-in user's active MOS membership in the selected company. The owner manages seats. Managers see all company sales records and can assign work; sales and viewer seats use assigned or company scope. Viewers cannot write. Assigned scope is enforced on lists, detail, related records, notes, summaries, mutations and command replays. Buyer package visibility follows its current deal assignment.

Invitations bind a verified Sharetribe email to an existing active AOS person. Acceptance never creates another Object or Passport. The invitation secret expires in seven days, is stored hashed, and is carried in a browser fragment. The recoverable acceptance command reuses the same membership after a lost response. Replaying an accepted invitation does not restore a revoked seat.

Financial actions and machine editing retain the existing company-owner authorization. Sales seats receive an allowlisted company machine catalog with read-only cards. Enabling a sales seat does not grant accounting authority.

## Durable work

Contacts, deals and follow-ups have current assignees, optimistic revisions and idempotent save commands. Call outcomes remain on completed follow-ups. Notes are append-only. Related work is scoped at read time. Existing MOS SQLite backup and restore cover sales records, commands, history and memberships.

Contact CSV import reviews up to 500 rows, identifies existing email/phone matches and file duplicates, and commits selected rows in batches of 25. Stable batch and row IDs make retry safe. Each row reports its outcome; a partially completed import never reports all rows saved.

Buyer packages save an explicit allowlist of reviewed machine details, with optional asking price and serial number. They retain the customer, deal, creator and revision. The PDF uses the saved snapshot, reports unavailable photos and includes no internal financial fields. Sending is a separate user action.

## Release checks

Run `npm test` and the required frontend paired gate against the exact backend pin. Tests cover verified invitations, revoked/expired access, assignment isolation, replay after reassignment, parent mismatches, partial imports, duplicate prevention, package field filtering and SQLite recovery. Release through the full immutable runtime workflow with backup/restore, installed manifest and canonical-data checks. Browser verification covers the actual authenticated owner desk, AOS and TRAN$ACT; do not create trial business records in production.

This release does not establish a measured concurrent-seat capacity. Measure production latency and usage before making a specific load or service-level guarantee.
