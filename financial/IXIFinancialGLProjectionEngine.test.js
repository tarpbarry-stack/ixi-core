"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFinancialGLProjection
} = require("./IXIFinancialGLProjectionEngine");

function journal(id, state) {
  return {
    financialDocumentId: id,
    documentType: "journal-entry",
    financialState: state,
    status: state,
    currency: "USD",
    period: "2026-09",
    occurredAt: "2026-09-02T00:00:00.000Z",
    lines: [
      { accountCode: "1000", accountName: "Cash", debit: 50, credit: 0 },
      { accountCode: "4000", accountName: "Revenue", debit: 0, credit: 50 }
    ],
    accounting: { balanced: true }
  };
}

test("GL projection includes posted journals and excludes drafts and reversals", () => {
  const projection = buildFinancialGLProjection({
    period: "2026-09",
    currency: "USD",
    records: [
      journal("ifd_posted", "posted"),
      journal("ifd_draft", "draft"),
      journal("ifd_reversed", "reversed")
    ]
  });

  assert.equal(projection.counts.sourceDocuments, 3);
  assert.equal(projection.counts.journals, 1);
  assert.equal(projection.counts.throughPeriodJournals, 1);
  assert.deepEqual(
    projection.journal.map(document => document.financialDocumentId),
    ["ifd_posted"]
  );
  assert.equal(projection.trialBalance.debits, 50);
  assert.equal(projection.trialBalance.credits, 50);
  assert.equal(projection.chart.source, "ixi-core");
  assert.equal(projection.chart.accounts.length > 0, true);
});

test("GL projection resolves reopen state and latest active posting-rule version", () => {
  const control = (type, id, occurredAt, extra = {}) => ({ financialDocumentId: id, documentType: type, financialState: type === "posting-rule" ? "approved" : "submitted", status: type === "period-close" ? "closed" : type === "period-reopen" ? "reopened" : "active", currency: "USD", period: "2026-09", occurredAt, ...extra });
  const projection = buildFinancialGLProjection({ period: "2026-09", currency: "USD", records: [
    control("period-close", "close-1", "2026-09-30T20:00:00.000Z", { closedAt: "2026-09-30T20:00:00.000Z", closedBy: "controller-1" }),
    control("period-reopen", "reopen-1", "2026-09-30T21:00:00.000Z", { reopenedAt: "2026-09-30T21:00:00.000Z", reopenedBy: "controller-2", priorCloseDocumentId: "close-1" }),
    control("posting-rule", "rule-v1", "2026-09-01T00:00:00.000Z", { postingRule: { identity: { ruleId: "invoice-standard", version: 1 }, control: { active: true }, match: {}, posting: {} } }),
    control("posting-rule", "rule-v2", "2026-09-02T00:00:00.000Z", { postingRule: { identity: { ruleId: "invoice-standard", version: 2 }, control: { active: true }, match: {}, posting: {} } })
  ] });
  assert.equal(projection.period.closed, false);
  assert.equal(projection.period.reopenDocumentId, "reopen-1");
  assert.equal(projection.period.closeDocumentId, "close-1");
  assert.equal(projection.postingRules.rules.length, 1);
  assert.equal(projection.postingRules.rules[0].identity.version, 2);
});
