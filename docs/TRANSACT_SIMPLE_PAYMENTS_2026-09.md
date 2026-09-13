# TRAN$ACT simple payments

This release adds payment support for saved unpaid Expenses and employee
reimbursements using the existing canonical Payment document. Company cash/card
Expenses already record the paid purchase; their payment details can be amended
without creating a second cash event. No existing business records are migrated.

- The existing DynamoDB payable balance transaction now protects Expense payments,
  corrections, and voids, including concurrent payments and source revisions.
- Outgoing payment references are optional. Customer deposits retain their own
  required evidence rules. Authenticated payment authority is unchanged.
- Payment corrections preserve source, currency, direction and revision history.
  Both original and revised accounting periods must remain open. Treasury and
  settlement payments continue through their dedicated workflows.
- A/P holds and disputes are checked by the payment command, including when the
  user starts from a Bill, Freight, Expense or Desktop view.
- New shared payment command retries recover committed results before checking
  the remaining balance, including a lost response to a final payment.
- Accounting close includes unpaid Expense and reimbursement balances, subtracting
  canonical payments once. Paid-at-entry purchases remain outside A/P.

Validation: factory/validation, preflight, Entity boundaries, concurrent balance
guards, amendments/voids, retry recovery and close controls are covered by
`financial/IXIFinancialExpensePayments.test.js`; all existing tests remain required.
Production delivery must use the complete paired-runtime workflow and its recovery,
manifest, canonical-data and health gates. Tests never mark a real charge paid.
