# TRAN$ACT Freight corrections

This release separates editable shipment facts from current AOS placement. Freight
requests may be saved before a carrier, route or price is known. The amendment
command accepts every existing request status, preserves canonical machine and
movement identity, checks the expected revision, and saves the request, detailed
history, command replay evidence and designated recipients' in-app alerts in one
DynamoDB transaction. Historical date corrections never issue MOS movement calls.

Freight reads Bill, credit and payment totals from current canonical financial
records, including legacy Bill links. It does not maintain a second editable
financial balance. Canonical financial revisions retain the prior amounts and
actor evidence. Missing legacy links are reported rather than silently treated as
verified accounting data. Bill estimates do not manufacture Purchase Orders.

A credit after payment reduces net cost while retaining cash already paid. A
$2,500 paid Bill plus a $500 credit has $2,000 net cost, no open payable, and $500
of available vendor credit. It does not invent a cash refund. Both Freight and
Payables allow credits up to the original Bill amount less previous credits.

Financial persistence serializes each Bill's settlements and corrections through
an integer-cent balance/version item committed in the same transaction as the
canonical document, revision, indexes and idempotency record. Existing Bills
adopt this counter from their canonical payment/credit history. A conditional
source Bill revision protects settlement against concurrent Bill corrections.
Concurrent commands cannot consume the same remaining payable balance. Failed
conditional writes require a refresh and retry; they do not create cash records.

The server supplies action capabilities to the Bill UI. Approved Bill economic
corrections require approval authority. Bill and credit economic revisions check
closed periods; existing period reopening remains the way to edit closed books.
No actor identity, accounting authorization or canonical ownership is inferred
from a client-entered role or name.

Request update recipients are active company Person Passports. Alerts are durable
in-app Freight records scoped to the designated person; broker/email distribution
is deferred. Customer rebilling and cash refunds remain explicit separate
financial records. A carrier credit is not a refund.

Verification covers optional drafts, closed-request edits, historical dates,
canonical projections, paid credits, credit revisions, Entity/currency boundaries,
concurrent settlement candidates and source-revision conditions. The paired release
must also pass the frontend integration gate against this exact backend commit.
