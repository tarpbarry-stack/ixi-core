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
