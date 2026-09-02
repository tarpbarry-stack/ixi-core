"use strict";

/*
 * Dedicated journal draft -> posted transition.
 *
 * Posting is deliberately separate from generic replacement. The caller must
 * supply trusted actor/entity identities and an optimistic-lock revision.
 */

function clean(value) {
  return String(value ?? "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function fail(name, message, details = {}) {
  const error = new Error(message);
  error.name = name;
  error.details = details;
  throw error;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round((number + Number.EPSILON) * 100) / 100
    : 0;
}

function assertPostableJournal(financialDocument = {}) {
  if (clean(financialDocument.documentType).toLowerCase() !== "journal-entry") {
    fail(
      "IXIFinancialJournalTypeError",
      "Only journal-entry documents may use the journal post command."
    );
  }

  const financialState = clean(financialDocument.financialState).toLowerCase();
  const status = clean(financialDocument.status).toLowerCase();

  if (financialState !== "draft" || status !== "draft") {
    fail(
      "IXIFinancialJournalStateConflictError",
      "Only a draft journal entry may be posted.",
      { financialState, status }
    );
  }

  const lines = Array.isArray(financialDocument.lines)
    ? financialDocument.lines
    : [];

  if (lines.length < 2) {
    fail(
      "IXIFinancialJournalEntryError",
      "Journal Entry requires at least two accounting lines."
    );
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const [index, line] of lines.entries()) {
    const debit = money(line?.debit);
    const credit = money(line?.credit);
    const exactlyOneSide = (debit > 0 && credit === 0) ||
      (credit > 0 && debit === 0);

    if (!exactlyOneSide) {
      fail(
        "IXIFinancialJournalLineError",
        `Journal line ${index + 1} must contain one positive debit or credit.`,
        { line: index + 1 }
      );
    }

    totalDebit = money(totalDebit + debit);
    totalCredit = money(totalCredit + credit);
  }

  if (totalDebit <= 0 || totalDebit !== totalCredit) {
    fail(
      "IXIFinancialJournalEntryBalanceError",
      `Journal Entry is unbalanced: debits ${totalDebit}, credits ${totalCredit}.`,
      { totalDebit, totalCredit }
    );
  }

  return { totalDebit, totalCredit };
}

async function postJournalEntry(input = {}, dependencies = {}) {
  const financialDocumentId = clean(input.financialDocumentId);
  const actorPassportId = clean(input.actorPassportId);
  const entityPassportId = clean(input.entityPassportId);
  const expectedRevision = Number(input.expectedRevision);

  if (!financialDocumentId || !actorPassportId || !entityPassportId) {
    fail(
      "IXIFinancialJournalPostCommandError",
      "financialDocumentId, actorPassportId, and entityPassportId are required."
    );
  }

  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    fail(
      "IXIFinancialRevisionRequiredError",
      "A positive integer expectedRevision is required to post a journal entry."
    );
  }

  const loadDocument = dependencies.loadDocument;
  const replaceDocument = dependencies.replaceDocument;
  const loadIdempotency = dependencies.loadIdempotency;
  const validateAccounts = dependencies.validateAccounts;
  const assertPeriodOpen = dependencies.assertPeriodOpen;
  const now = dependencies.now || (() => new Date().toISOString());

  if ([loadDocument, loadIdempotency, replaceDocument, validateAccounts, assertPeriodOpen]
    .some(dependency => typeof dependency !== "function")) {
    fail(
      "IXIFinancialJournalPostConfigurationError",
      "Journal posting dependencies are incomplete."
    );
  }

  const record = await loadDocument(financialDocumentId);

  if (!record?.financialDocument) {
    fail(
      "IXIFinancialDocumentNotFoundError",
      "Journal entry was not found.",
      { financialDocumentId }
    );
  }

  if (clean(record.server?.entityPassportId) !== entityPassportId) {
    fail(
      "IXIFinancialAuthorizationError",
      "Financial permission denied."
    );
  }

  const idempotencyKey = clean(input.idempotencyKey);
  if (idempotencyKey) {
    const previous = await loadIdempotency(idempotencyKey);

    if (previous) {
      if (clean(previous.financialDocumentId) !== financialDocumentId) {
        fail(
          "IXIFinancialConflictError",
          "Idempotency key belongs to a different Financial Document."
        );
      }

      if (
        clean(record.financialDocument.financialState).toLowerCase() === "posted" &&
        clean(record.financialDocument.status).toLowerCase() === "posted"
      ) {
        return {
          ok: true,
          operation: "financial.document.replace",
          data: {
            updated: false,
            idempotentReplay: true,
            record
          },
          errors: [],
          warnings: []
        };
      }
    }
  }

  const currentRevision = Number(record.server?.revision);
  if (currentRevision !== expectedRevision) {
    fail(
      "IXIFinancialRevisionConflictError",
      `Expected revision ${expectedRevision}; current revision is ${currentRevision}.`,
      { expectedRevision, currentRevision }
    );
  }

  const accounting = assertPostableJournal(record.financialDocument);

  await validateAccounts({
    financialDocument: record.financialDocument,
    entityPassportId
  });

  await assertPeriodOpen({
    financialDocument: record.financialDocument,
    entityPassportId
  });

  const postedAt = now();
  const financialDocument = {
    ...record.financialDocument,
    financialState: "posted",
    status: "posted",
    accounting: {
      ...safeObject(record.financialDocument.accounting),
      ...accounting,
      balanced: true
    },
    metadata: {
      ...safeObject(record.financialDocument.metadata),
      journalTransition: "draft-to-posted",
      journalPostCommandVersion: "1.0.0",
      postedAt,
      postedBy: actorPassportId
    }
  };

  return replaceDocument({
    financialDocument,
    actorPassportId,
    expectedRevision,
    commandId: clean(input.commandId),
    idempotencyKey,
    requestId: clean(input.requestId),
    source: clean(input.source || "ixi-financial-journal-post"),
    metadata: {
      ...safeObject(input.metadata),
      transition: "draft-to-posted",
      postedAt,
      postedBy: actorPassportId
    },
    auditEventType: "post"
  });
}

module.exports = {
  assertPostableJournal,
  postJournalEntry
};
