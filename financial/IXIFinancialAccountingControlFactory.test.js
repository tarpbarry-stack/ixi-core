"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPeriodReopenDocument, createPostingRuleDocument } = require("./IXIFinancialAccountingControlFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");

test("period reopen preserves prior-close lineage and permission evidence", () => {
  const document = createPeriodReopenDocument({
    period: "2026-09", reopenedAt: "2026-10-03T12:00:00.000Z", reopenedBy: "actor-1",
    reopenReason: "Correct an approved bank reconciliation difference.", priorCloseDocumentId: "ifd-close-1",
    permissionEvidence: { entityPassportId: "entity-1" }, references: [{ role: "entity", passportId: "entity-1" }]
  });
  assert.equal(document.relationships[0].financialDocumentId, "ifd-close-1");
  assert.equal(document.permissionEvidence.action, "financial.gl.period.reopen");
  assert.equal(document.metadata.browserCalculated, false);
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("posting rules are versioned, approved, non-economic control documents", () => {
  const document = createPostingRuleDocument({
    actorPassportId: "actor-1", entityPassportId: "entity-1", occurredAt: "2026-09-03T12:00:00.000Z",
    postingRule: { identity: { ruleId: "invoice-standard", version: 3 }, match: { documentType: "invoice" }, posting: { debitAccountCode: "1100", creditAccountCode: "4100" }, effectivePeriod: "2026-09", changeReason: "Approve standard invoice recognition rule." },
    references: [{ role: "entity", passportId: "entity-1" }]
  });
  assert.equal(document.postingRule.identity.version, 3);
  assert.equal(document.postingRule.control.approvedByPassportId, "actor-1");
  assert.equal(document.accountingTreatment.economicEvent, false);
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("accounting control evidence rejects weak reasons", () => {
  assert.throws(() => createPeriodReopenDocument({ period: "2026-09", reopenedBy: "actor-1", reopenReason: "fix", priorCloseDocumentId: "close-1" }), /at least 10/i);
});
