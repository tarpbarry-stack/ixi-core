"use strict";
const clean = value => String(value ?? "").trim();

// Recover an acknowledged write before checking today's remaining balance.
// Otherwise a lost response to the final payment looks like an overpayment
// when the user retries the same command.
async function findPaymentReplay(command, { getIdempotency, getDocument }) {
  if (command.documentType !== "payment" || !clean(command.idempotencyKey).startsWith("ixi-payment:")) return null;
  const previous = await getIdempotency(command.idempotencyKey);
  if (!previous) return null;
  const response = await getDocument({ financialDocumentId: previous.financialDocumentId });
  const record = response?.data?.record, document = record?.financialDocument;
  if (!response?.ok || !document) throw new Error("The saved payment could not be reloaded. Refresh before recording another payment.");
  if (clean(record.server?.entityPassportId) !== clean(command.entityPassportId) || document.documentType !== "payment" || clean(document.sourceFinancialDocumentId) !== clean(command.input?.sourceFinancialDocumentId) || clean(document.paymentDirection) !== clean(command.input?.paymentDirection)) {
    throw new Error("This payment reference belongs to another transaction. Reopen the original payment.");
  }
  const input = command.input || {};
  const changedAmount = input.amount != null && Math.round(Number(input.amount) * 100) !== Math.round(Number(document.totals?.total) * 100);
  const changedDetails = ["currency", "paymentMethod", "transactionReference", "memo"].some(key => input[key] != null && clean(input[key]) !== clean(document[key]));
  const changedDate = input.occurredAt && Date.parse(input.occurredAt) !== Date.parse(document.occurredAt);
  if (changedAmount || changedDetails || changedDate) throw new Error("This payment was already saved with different details. Refresh and edit that saved payment; do not enter another payment.");
  return { ok: true, commandId: command.commandId, idempotencyKey: command.idempotencyKey, stage: "complete", documentType: "payment", financialDocument: document, record, created: false, idempotentReplay: true, errors: [], warnings: [] };
}
module.exports = { findPaymentReplay };
