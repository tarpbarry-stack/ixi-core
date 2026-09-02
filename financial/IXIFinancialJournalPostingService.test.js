"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  postJournalEntry
} = require("./IXIFinancialJournalPostingService");

function journal(overrides = {}) {
  return {
    financialDocumentId: "ifd_journal_001",
    documentType: "journal-entry",
    financialState: "draft",
    status: "draft",
    currency: "USD",
    period: "2026-09",
    lines: [
      { accountCode: "1000", debit: 125, credit: 0 },
      { accountCode: "4000", debit: 0, credit: 125 }
    ],
    accounting: { balanced: true, totalDebit: 125, totalCredit: 125 },
    metadata: { source: "test" },
    ...overrides
  };
}

function dependencies(financialDocument = journal(), revision = 3) {
  const calls = [];

  return {
    calls,
    value: {
      loadDocument: async id => ({
        financialDocument: { ...financialDocument, financialDocumentId: id },
        server: { entityPassportId: "entity_1", revision }
      }),
      loadIdempotency: async () => null,
      validateAccounts: async input => calls.push(["accounts", input]),
      assertPeriodOpen: async input => calls.push(["period", input]),
      replaceDocument: async input => {
        calls.push(["replace", input]);
        return { ok: true, data: { record: { financialDocument: input.financialDocument } } };
      },
      now: () => "2026-09-02T12:00:00.000Z"
    }
  };
}

test("posts a balanced entity-owned draft through all accounting controls", async () => {
  const deps = dependencies();

  const result = await postJournalEntry({
    financialDocumentId: "ifd_journal_001",
    actorPassportId: "actor_1",
    entityPassportId: "entity_1",
    expectedRevision: 3,
    commandId: "cmd_1",
    idempotencyKey: "idem_1"
  }, deps.value);

  assert.equal(result.ok, true);
  assert.deepEqual(deps.calls.map(([name]) => name), ["accounts", "period", "replace"]);

  const replacement = deps.calls[2][1];
  assert.equal(replacement.expectedRevision, 3);
  assert.equal(replacement.auditEventType, "post");
  assert.equal(replacement.financialDocument.financialState, "posted");
  assert.equal(replacement.financialDocument.status, "posted");
  assert.equal(replacement.financialDocument.metadata.postedBy, "actor_1");
  assert.equal(replacement.financialDocument.metadata.postedAt, "2026-09-02T12:00:00.000Z");
});

test("rejects non-draft journals before account or period controls", async () => {
  const deps = dependencies(journal({ financialState: "posted", status: "posted" }));

  await assert.rejects(
    postJournalEntry({
      financialDocumentId: "ifd_journal_001",
      actorPassportId: "actor_1",
      entityPassportId: "entity_1",
      expectedRevision: 3
    }, deps.value),
    { name: "IXIFinancialJournalStateConflictError" }
  );

  assert.deepEqual(deps.calls, []);
});

test("rejects stale revisions and cross-entity posting", async () => {
  const stale = dependencies();
  await assert.rejects(
    postJournalEntry({
      financialDocumentId: "ifd_journal_001",
      actorPassportId: "actor_1",
      entityPassportId: "entity_1",
      expectedRevision: 2
    }, stale.value),
    { name: "IXIFinancialRevisionConflictError" }
  );

  const foreign = dependencies();
  await assert.rejects(
    postJournalEntry({
      financialDocumentId: "ifd_journal_001",
      actorPassportId: "actor_1",
      entityPassportId: "entity_2",
      expectedRevision: 3
    }, foreign.value),
    { name: "IXIFinancialAuthorizationError" }
  );
});

test("rejects malformed and unbalanced journal lines", async () => {
  const deps = dependencies(journal({
    lines: [
      { accountCode: "1000", debit: 125, credit: 10 },
      { accountCode: "4000", debit: 0, credit: 115 }
    ]
  }));

  await assert.rejects(
    postJournalEntry({
      financialDocumentId: "ifd_journal_001",
      actorPassportId: "actor_1",
      entityPassportId: "entity_1",
      expectedRevision: 3
    }, deps.value),
    { name: "IXIFinancialJournalLineError" }
  );
});

test("replays a completed post idempotently without re-running controls", async () => {
  const deps = dependencies(
    journal({ financialState: "posted", status: "posted" }),
    4
  );
  deps.value.loadIdempotency = async () => ({
    financialDocumentId: "ifd_journal_001"
  });

  const result = await postJournalEntry({
    financialDocumentId: "ifd_journal_001",
    actorPassportId: "actor_1",
    entityPassportId: "entity_1",
    expectedRevision: 3,
    idempotencyKey: "idem_post_1"
  }, deps.value);

  assert.equal(result.ok, true);
  assert.equal(result.data.idempotentReplay, true);
  assert.deepEqual(deps.calls, []);
});
