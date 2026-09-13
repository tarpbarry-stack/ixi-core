"use strict";
const { isPayableSource } = require("./IXIFinancialExpensePaymentPolicy");

const clean = value => String(value ?? "").trim();
const doc = record => record?.financialDocument || {};
const active = document => !["void", "reversed", "cancelled"].includes(clean(document.financialState));
const cents = document => active(document) ? Math.round(Number(document.totals?.total || 0) * 100) : 0;

// The balance/version item and canonical document are written in ONE DynamoDB
// transaction. Two users cannot both spend the same remaining Bill balance.
async function payableBalanceTransactionItems({ record, previousRecord, tableName, getRecord, getGuard, listRecords }) {
  const document = doc(record), previous = doc(previousRecord), type = clean(document.documentType);
  const isBill = isPayableSource(document) || isPayableSource(previous);
  if (!isBill && !(type === "credit" || (type === "payment" && document.paymentDirection === "outflow"))) return [];
  const billId = clean(isBill ? document.financialDocumentId : document.sourceFinancialDocumentId);
  if (!billId) return [];
  const key = { PK: `FIN#${billId}`, SK: "PAYABLE_BALANCE" };
  const guard = await getGuard(key);
  const billRecord = isBill ? record : await getRecord(billId);
  const bill = doc(billRecord);
  if (!isPayableSource(bill) && !isPayableSource(previous)) return [];
  const entity = clean(record.server?.entityPassportId);
  if (!entity || entity !== clean(billRecord?.server?.entityPassportId)) throw new Error("Bill and settlement must belong to the same Entity.");
  if (clean(document.currency) !== clean(bill.currency)) throw new Error("Bill and settlement currencies must match.");
  if (previous.sourceFinancialDocumentId && clean(previous.sourceFinancialDocumentId) !== clean(document.sourceFinancialDocumentId)) throw new Error("A saved payment or credit cannot be moved to another Bill.");
  let paid = Number(guard?.paidCents || 0), credited = Number(guard?.creditCents || 0);
  if (!guard && !(isBill && !previousRecord)) {
    // Existing Bills adopt the counter from canonical records on the first
    // correction/settlement. The absent-item condition serializes adoption.
    for (const existing of await listRecords(entity)) {
      const item = doc(existing);
      if (clean(item.sourceFinancialDocumentId) !== billId) continue;
      if (item.documentType === "credit") credited += cents(item);
      if (item.documentType === "payment" && item.paymentDirection === "outflow") paid += cents(item);
    }
  }
  if (isBill && type === "expense" && paid > 0 && clean(previous.paymentMethod) !== clean(document.paymentMethod)) throw new Error("This Expense has saved payments. Correct those payments before changing how the Expense was paid.");
  const delta = cents(document) - (previousRecord ? cents(previous) : 0);
  if (type === "credit") credited += delta;
  if (type === "payment") paid += delta;
  const billCents = cents(bill);
  if (![paid, credited, billCents].every(Number.isSafeInteger) || paid < 0 || credited < 0) throw new Error("The Bill balance could not be verified. Reload before saving.");
  if (credited > billCents) throw new Error("Credits exceed this Bill's amount. Correct the credit or Bill amount before saving.");
  if (type === "payment" && delta > 0 && paid + credited > billCents) throw new Error("Payment exceeds the remaining Bill balance after credits and earlier payments.");
  const items = [{ Put: { TableName: tableName, Item: { ...key, entityType: "financial-payable-balance", entityPassportId: entity, billId,
    version: Number(guard?.version || 0) + 1, billCents, paidCents: paid, creditCents: credited },
    ConditionExpression: guard ? "#version = :expectedVersion" : "attribute_not_exists(PK)",
    ...(guard ? { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expectedVersion": guard.version } } : {}) } }];
  if (!isBill) items.push({ ConditionCheck: { TableName: tableName, Key: { PK: `FIN#${billId}`, SK: "CURRENT" },
    ConditionExpression: "#revision = :expectedRevision", ExpressionAttributeNames: { "#revision": "revision" },
    ExpressionAttributeValues: { ":expectedRevision": billRecord.server.revision } } });
  return items;
}

module.exports = { payableBalanceTransactionItems };
