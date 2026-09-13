"use strict";

const clean = value => String(value ?? "").trim().toLowerCase();

// Paid-With on an existing expense is already an economic payment. Never
// manufacture another cash outflow for company cash/card purchases.
function expenseCreatesPayable(document = {}) {
  if (clean(document.documentType) !== "expense") return false;
  const method = clean(document.paymentMethod || document.expense?.paymentMethod || document.expenseRecord?.expense?.paymentMethod);
  return ["unpaid", "my-money"].includes(method);
}

function isPayableSource(document = {}) {
  return ["bill", "supplier-invoice"].includes(clean(document.documentType)) || expenseCreatesPayable(document);
}

module.exports = { expenseCreatesPayable, isPayableSource };
