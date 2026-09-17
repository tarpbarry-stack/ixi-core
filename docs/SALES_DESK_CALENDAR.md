# Sales Desk connected calendar and daily work

## What changes

Sales Desk adds Calendar, Today, and Inquiries alongside the existing machine board. Switching views preserves the mounted board and its open machines. Calendar preserves its current date and view. The priority strip opens Today, Overdue, Unassigned, Next 7 Days, and Reminders. Existing CRM, team access, buyer packages, and financial handoffs remain available.

Calendar provides day, week, month, and 30-day agenda views; personal and authorized team schedules; all-day or timed calls, follow-ups, appointments, inspections, demonstrations, pickups, and deliveries; assignment; location; outcomes; and completion/cancellation. An appointment can link to an existing customer, deal, and machines. Opening a linked deal restores its machines on the board.

A deal's primary next action and separately scheduled follow-ups are separate commitments. Each commitment is projected from its original durable deal/task record in Calendar, Today, and connected work. Rescheduling or completing it updates that same record; the calendar does not create a second appointment copy. Scheduling an additional follow-up intentionally creates a separate record.

Drag-to-reschedule previews overlaps and asks for confirmation. Editing the date or time through the record dialog provides the same operation without dragging. Dates retain their IANA time zone and UTC instants. Invalid daylight-saving gaps are rejected; repeated times have an explicit earlier/later choice. All-day reminders use 09:00 in the appointment's zone.

Daily work includes today, overdue prior dates, the next seven days, unassigned work, new inquiries, waiting on the customer, approval, and deals without an update for seven days. In-app reminders appear in the priority strip while Sales Desk is open, refreshed every minute and on focus. This release does not send email, SMS, external calendar invitations, or offline push reminders.

## Marketplace intake

Only the company owner can run SYNC MARKETPLACE INQUIRIES. The proxy retrieves seller-scoped inquiries from the verified Sharetribe Integration API; browser-supplied source rows or authority are not accepted. Optional polling runs every two minutes while the inquiry view is open after the user enables it. There is no background job when the desk is closed.

Each original inquiry is retained as an immutable source record. Repeated syncs return the existing source record. Customer source IDs bind to canonical contacts; email/phone matches reuse an existing contact, while ambiguous matches require review. Repeated inquiries for the same customer and machine reuse an existing active opportunity and retain each original message. New inquiries enter the unassigned queue for review. Only contact details submitted by the buyer are imported; private account data is excluded.

A failed intake page reports row outcomes. Retrying is safe. Customer admission can be recovered independently; opportunity creation and original inquiry persistence share one transaction. Intake does not overwrite existing customer information or invent sold/payment facts.

## Integrity and access

Every read and write is company-scoped and checks the current membership. Personal/team scope follows the existing role and visibility policy. Inquiry visibility follows its currently assigned deal. Viewer seats cannot write. Overlap previews conceal details of commitments outside the caller's record scope.

Writes use command IDs and expected revisions. Retrying a request with an uncertain response confirms the original command instead of creating another appointment. Concurrent stale edits return a conflict and preserve the user's draft. Calendar data is paginated; only requested date ranges are loaded. No record is created by reading a calendar or queue.

TRAN$ACT remains the authority for quotes, orders, invoices, payments, sale date/price, SOLD movement, and settlement. Appointment completion and CRM stages never post financial records, change inventory ownership, or close accounting periods.

## Verification and release

Tests exercise the real editor and calendar components against an isolated paired backend: create/save, a lost response and retry, reopen, complete with outcome, stale-edit rejection, and confirmed drag rescheduling. Core tests cover time zones, daylight-saving transitions, overnight appointments, overlap boundaries, role/scope enforcement, source deduplication, interrupted intake recovery, and pagination.

A bounded local HTTP test loads 10,000 isolated appointments and executes 100 reads with 10 concurrent readers. It also verifies simultaneous command replay and stale-edit rejection. This is local evidence, not a production concurrent-seat guarantee.

Run the required paired AOS/TRAN$ACT gate against the exact immutable backend pin, then the production frontend build. Deploy the complete pinned backend before activating the new frontend. Audit backup/restore, runtime manifest, canonical data preservation, health, and the authenticated live Sales Desk, AOS, and TRAN$ACT. Do not create dummy business records during production verification.

Acceptance: calendar views and scope work; saved appointments survive reopening; moves and completion affect the same record; conflicting edits remain visible; inquiry retries do not duplicate customers/opportunities; existing machine boards and financial handoffs remain usable; role restrictions hold; normal navigation produces no application errors.
