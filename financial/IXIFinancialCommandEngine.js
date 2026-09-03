"use strict";

/*
 * IXI FINANCIAL COMMAND ENGINE
 *
 * PURPOSE
 * -------
 *
 * One orchestration command for creating
 * Financial Documents from AOS / Face input.
 *
 *
 * CALLER PROVIDES
 * ---------------
 *
 * documentType
 * input
 *
 * actorPassportId
 * entityPassportId
 *
 * idempotencyKey
 * commandId
 *
 * optional snapshot target
 *
 *
 * ENGINE DOES
 * -----------
 *
 * Factory Registry
 *      ↓
 * canonical Financial Document
 *      ↓
 * Provider Service
 *      ↓
 * validation + persistence + audit
 *      ↓
 * refreshed Financial Snapshot
 *
 *
 * IMPORTANT
 * ---------
 *
 * This file does NOT own:
 *
 * - physical storage
 * - accounting math
 * - lifecycle math
 * - authorization policy
 * - recursive hierarchy discovery
 *
 * It orchestrates already-proven engines.
 */


const crypto =
  require("crypto");


const {
  createFinancialDocumentByType
} =
  require(
    "./IXIFinancialDocumentFactoryRegistry"
  );


const {
  validateFinancialDocument
} =
  require(
    "./IXIFinancialValidationBridge"
  );


const providerService =
  require(
    "./IXIFinancialProviderService"
  );


const {
  postJournalEntry
} =
  require(
    "./IXIFinancialJournalPostingService"
  );



const financialStore =
  require(
    "./IXIFinancialDynamoStore"
  );



const {
  getFinancialGLProjection
} =
  require(
    "./IXIFinancialGLService"
  );


/* =========================================================
   HELPERS
   ========================================================= */

function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function randomId(
  prefix
) {
  return `${prefix}_${crypto
    .randomBytes(12)
    .toString("hex")}`;
}


/* =========================================================
   COMMAND IDS
   ========================================================= */

function createFinancialCommandId() {
  return randomId(
    "ifc"
  );
}


function createFinancialIdempotencyKey() {
  return randomId(
    "idem"
  );
}


/* =========================================================
   COMMAND INPUT NORMALIZATION
   ========================================================= */

function normalizeFinancialCreateCommand(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  return {
    commandId:
      clean(
        source.commandId
      ) ||
      createFinancialCommandId(),

    idempotencyKey:
      clean(
        source.idempotencyKey
      ) ||
      createFinancialIdempotencyKey(),

    documentType:
      clean(
        source.documentType
      ).toLowerCase(),

    input: {
      ...safeObject(
        source.input
      )
    },

    actorPassportId:
      clean(
        source.actorPassportId
      ),

    entityPassportId:
      clean(
        source.entityPassportId
      ),

    source:
      clean(
        source.source ||
        "ixi-financial-command"
      ),

    requestId:
      clean(
        source.requestId
      ),

    metadata: {
      ...safeObject(
        source.metadata
      )
    },

    snapshot: {
      mode:
        clean(
          source.snapshot
            ?.mode ||
          "passport"
        ).toLowerCase(),

      passportId:
        clean(
          source.snapshot
            ?.passportId
      ),

      rootPassportId:
        clean(
          source.snapshot
            ?.rootPassportId
        ),

      scopePassportIds:
        safeArray(
          source.snapshot
            ?.scopePassportIds
        )
          .map(
            clean
          )
          .filter(
            Boolean
          ),

      currency:
        clean(
          source.snapshot
            ?.currency ||
          source.input
            ?.currency ||
          "USD"
        ).toUpperCase(),

      includeFacts:
        source.snapshot
          ?.includeFacts ===
            undefined
          ? true
          : Boolean(
              source.snapshot
                .includeFacts
            ),

      recentActivityLimit:
        Number(
          source.snapshot
            ?.recentActivityLimit ||
          5
        )
    }
  };
}


/* =========================================================
   INFER SNAPSHOT PASSPORT
   ========================================================= */

function inferPrimaryPassportId(
  financialDocument = {}
) {
  const references =
    safeArray(
      financialDocument
        ?.references
    );


  const preferredRoles = [
    "asset",
    "job",
    "entity",
    "location",
    "customer",
    "vendor",
    "employee",
    "technician"
  ];


  for (
    const role of
      preferredRoles
  ) {

    const reference =
      references.find(
        item =>
          clean(
            item?.role
          ) ===
            role &&
          clean(
            item?.passportId
          )
      );


    if (
      reference
    ) {
      return clean(
        reference.passportId
      );
    }
  }


  return clean(
    references[0]
      ?.passportId
  );
}


/* =========================================================
   SNAPSHOT REFRESH
   ========================================================= */

async function createCommandSnapshot({
  financialDocument,
  snapshot
} = {}) {
  const config =
    safeObject(
      snapshot
    );


  if (
    config.mode ===
      "none"
  ) {
    return null;
  }


  if (
    config.mode ===
      "scope"
  ) {

    const rootPassportId =
      clean(
        config.rootPassportId
      );


    const scopePassportIds =
      safeArray(
        config.scopePassportIds
      )
        .map(
          clean
        )
        .filter(
          Boolean
        );


    if (
      !rootPassportId &&
      scopePassportIds.length ===
        0
    ) {
      return null;
    }


    return await providerService
      .getScopeSnapshot({
        rootPassportId,

        scopePassportIds,

        currency:
          config.currency ||
          financialDocument
            ?.currency ||
          "USD",

        includeFacts:
          config.includeFacts,

        recentActivityLimit:
          config.recentActivityLimit
      });
  }


  const passportId =
    clean(
      config.passportId
    ) ||
    inferPrimaryPassportId(
      financialDocument
    );


  if (
    !passportId
  ) {
    return null;
  }


  return await providerService
    .getPassportSnapshot({
      passportId,

      currency:
        config.currency ||
        financialDocument
          ?.currency ||
        "USD",

      includeFacts:
        config.includeFacts,

      recentActivityLimit:
        config.recentActivityLimit
    });
}


/* =========================================================
   CHART OF ACCOUNTS CONTROL
   ========================================================= */

async function validateJournalAccounts({
  financialDocument = {},
  entityPassportId = ""
} = {}) {
  const document =
    safeObject(
      financialDocument
    );


  if (
    clean(
      document.documentType
    ).toLowerCase() !==
      "journal-entry"
  ) {
    return {
      checked:
        false,

      valid:
        true,

      accounts:
        []
    };
  }


  const entityId =
    clean(
      entityPassportId
    );


  if (!entityId) {
    const error =
      new Error(
        "Journal account validation requires entityPassportId."
      );

    error.name =
      "IXIFinancialEntityRequiredError";

    throw error;
  }


  const lines =
    safeArray(
      document.lines
    );


  const codes =
    Array.from(
      new Set(
        lines
          .map(
            line =>
              clean(
                line?.accountCode
              )
          )
          .filter(Boolean)
      )
    );


  if (!codes.length) {
    const error =
      new Error(
        "Journal entry contains no account codes."
      );

    error.name =
      "IXIFinancialAccountRequiredError";

    throw error;
  }


  const resolved =
    await Promise.all(
      codes.map(
        async accountCode => ({
          accountCode,

          account:
            await financialStore
              .getFinancialAccount(
                entityId,
                accountCode
              )
        })
      )
    );


  const missing =
    resolved.filter(
      item =>
        !item.account
    );


  if (missing.length) {
    const error =
      new Error(
        `Journal contains ${missing.length} unknown Chart of Accounts account(s).`
      );

    error.name =
      "IXIFinancialUnknownAccountError";

    error.details = {
      entityPassportId:
        entityId,

      accountCodes:
        missing.map(
          item =>
            item.accountCode
        )
    };

    throw error;
  }


  const inactive =
    resolved.filter(
      item =>
        item.account
          ?.active !==
            true
    );


  if (inactive.length) {
    const error =
      new Error(
        `Journal contains ${inactive.length} inactive Chart of Accounts account(s).`
      );

    error.name =
      "IXIFinancialInactiveAccountError";

    error.details = {
      entityPassportId:
        entityId,

      accountCodes:
        inactive.map(
          item =>
            item.accountCode
        )
    };

    throw error;
  }


  /*
   * Canonical identity enforcement.
   *
   * Account code determines the authoritative
   * account name. The browser may not relabel
   * a valid account code.
   */
  const mismatchedNames =
    lines
      .map(line => {
        const accountCode =
          clean(
            line?.accountCode
          );

        const configured =
          resolved.find(
            item =>
              item.accountCode ===
                accountCode
          )
          ?.account;


        if (!configured) {
          return null;
        }


        const suppliedName =
          clean(
            line?.accountName
          );


        const canonicalName =
          clean(
            configured.accountName
          );


        if (
          suppliedName &&
          suppliedName !==
            canonicalName
        ) {
          return {
            accountCode,
            suppliedName,
            canonicalName
          };
        }


        return null;
      })
      .filter(Boolean);


  if (mismatchedNames.length) {
    const error =
      new Error(
        `Journal contains ${mismatchedNames.length} account name mismatch(es).`
      );

    error.name =
      "IXIFinancialAccountIdentityMismatchError";

    error.details = {
      entityPassportId:
        entityId,

      accounts:
        mismatchedNames
    };

    throw error;
  }


  return {
    checked:
      true,

    valid:
      true,

    accounts:
      resolved.map(
        item =>
          item.account
      )
  };
}


/* =========================================================
   ACCOUNTING PERIOD CONTROL
   ========================================================= */

function resolveFinancialDocumentPeriod(
  financialDocument = {}
) {
  const explicit =
    clean(
      financialDocument
        ?.period
    );


  if (
    /^\d{4}-\d{2}$/.test(
      explicit
    )
  ) {
    return explicit;
  }


  const candidates = [
    financialDocument
      ?.occurredAt,

    financialDocument
      ?.documentDate
  ];


  for (
    const candidate
    of candidates
  ) {
    const value =
      clean(
        candidate
      );


    const match =
      value.match(
        /^(\d{4}-\d{2})/
      );


    if (
      match
    ) {
      return match[1];
    }
  }


  return "";
}


function isPeriodControlDocument(
  financialDocument = {}
) {
  return (
    clean(
      financialDocument
        ?.documentType
    ).toLowerCase() ===
      "period-close"
  );
}


function hasEconomicValue(
  financialDocument = {}
) {
  const total =
    Number(
      financialDocument
        ?.totals
        ?.total
    );


  if (
    Number.isFinite(total) &&
    total !== 0
  ) {
    return true;
  }


  return safeArray(
    financialDocument
      ?.lines
  ).some(
    line => {
      const amount =
        Number(
          line?.amount
        );

      return (
        Number.isFinite(amount) &&
        amount !== 0
      );
    }
  );
}


function isNonEconomicOperationalWorkOrder(
  financialDocument = {}
) {
  return (
    clean(
      financialDocument
        ?.documentType
    ).toLowerCase() ===
      "work-order" &&
    !hasEconomicValue(
      financialDocument
    )
  );
}

function isNonEconomicOperationalCapture(
  financialDocument = {}
) {
  const documentType = clean(financialDocument?.documentType).toLowerCase();
  const isMaterialUsage = documentType === "material-usage";
  return (
    (["work-order", "time-entry"].includes(documentType) && !hasEconomicValue(financialDocument)) ||
    (isMaterialUsage && financialDocument?.costAttribution?.economicEvent === false) ||
    (documentType === "service-quote" && financialDocument?.accountingTreatment?.economicEvent === false)
  );
}


async function assertFinancialPeriodOpen({
  financialDocument = {},
  entityPassportId = ""
} = {}) {
  /*
   * The period-close command itself is what
   * transitions an open period to closed.
   *
   * It therefore cannot be rejected merely
   * because it is the period-control document.
   */
  if (
    isPeriodControlDocument(
      financialDocument
    )
  ) {
    return {
      checked:
        false,

      controlDocument:
        true
    };
  }


  /*
   * A zero-value Work Order is operational truth,
   * not an accounting posting. Field work must remain
   * available while accountants close or repair books.
   * The period gate still applies as soon as the Work
   * Order carries any economic value.
   */
  if (
    isNonEconomicOperationalCapture(
      financialDocument
    )
  ) {
    return {
      checked:
        false,

      operationalCapture:
        true,

      economicValue:
        false
    };
  }


  const resolvedEntityPassportId =
    clean(
      entityPassportId
    );


  if (
    !resolvedEntityPassportId
  ) {
    const error =
      new Error(
        "Financial period control requires entityPassportId."
      );

    error.name =
      "IXIFinancialEntityRequiredError";

    throw error;
  }


  const period =
    resolveFinancialDocumentPeriod(
      financialDocument
    );


  if (
    !period
  ) {
    const error =
      new Error(
        "Financial document accounting period could not be resolved."
      );

    error.name =
      "IXIFinancialAccountingPeriodRequiredError";

    throw error;
  }


  const currency =
    clean(
      financialDocument
        ?.currency ||
      "USD"
    ).toUpperCase();


  const gl =
    await getFinancialGLProjection({
      entityPassportId:
        resolvedEntityPassportId,

      period,

      currency
    });


  const periodState =
    gl
      ?.projection
      ?.period ||
    {};


  if (
    periodState.closed ===
      true
  ) {
    const error =
      new Error(
        `Accounting period ${period} is closed.`
      );

    error.name =
      "IXIFinancialPeriodClosedError";

    error.details = {
      entityPassportId:
        resolvedEntityPassportId,

      period,

      currency,

      closeDocumentId:
        clean(
          periodState
            ?.closeDocumentId
        ),

      closedAt:
        clean(
          periodState
            ?.closedAt
        ),

      closedBy:
        clean(
          periodState
            ?.closedBy
        )
    };

    throw error;
  }


  return {
    checked:
      true,

    period,

    currency,

    closed:
      false
  };
}


/* =========================================================
   CREATE FINANCIAL DOCUMENT COMMAND
   ========================================================= */

async function executeCreateFinancialDocumentCommand(
  input = {},
  options = {}
) {
  const command =
    normalizeFinancialCreateCommand(
      input
    );


  if (
    !command.documentType
  ) {
    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "command",

      errors: [
        {
          name:
            "IXIFinancialCommandError",

          message:
            "documentType is required."
        }
      ]
    };
  }


  /*
   * PERIOD CONTROL DOCUMENT GATE
   * ----------------------------
   *
   * period-close is not an ordinary Financial
   * Document creation operation.
   *
   * Only the server-side close command may
   * authorize its creation.
   */
  if (
    command.documentType ===
      "period-close" &&
    options
      ?.allowPeriodControl !==
        true
  ) {
    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "period-control",

      errors: [
        {
          name:
            "IXIFinancialPeriodCloseCommandRequiredError",

          message:
            "Accounting periods may only be closed through the dedicated period-close control command."
        }
      ],

      warnings:
        []
    };
  }


  let financialDocument;


  /*
   * STEP 1
   * ------
   * Factory Registry
   */
  try {

    financialDocument =
      createFinancialDocumentByType({
        documentType:
          command.documentType,

        input:
          command.input
      });

  } catch (
    error
  ) {

    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "factory",

      errors: [
        {
          name:
            clean(
              error?.name ||
              "IXIFinancialFactoryError"
            ),

          message:
            clean(
              error?.message ||
              "Financial factory failed."
            ),

          details:
            safeObject(
              error?.details
            )
        }
      ]
    };
  }


  /*
   * STEP 2
   * ------
   * Explicit preflight validation.
   *
   * Provider Service validates again before
   * persistence. This preflight gives the
   * command caller a clean stage result.
   */
  const validation =
    validateFinancialDocument(
      financialDocument
    );


  if (
    !validation.ok
  ) {

    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "validation",

      financialDocument,

      validation,

      errors:
        validation.errors,

      warnings:
        validation.warnings
    };
  }


  /*
   * STEP 3
   * ------
   * Server Chart of Accounts control.
   *
   * New journal truth must use existing,
   * active Entity-owned accounts.
   */
  try {

    await validateJournalAccounts({
      financialDocument:
        validation.normalized,

      entityPassportId:
        command.entityPassportId
    });

  } catch (
    error
  ) {

    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "account-control",

      financialDocument:
        validation.normalized,

      errors: [
        {
          name:
            clean(
              error?.name ||
              "IXIFinancialAccountControlError"
            ),

          message:
            clean(
              error?.message ||
              "Financial Chart of Accounts control failed."
            ),

          details:
            safeObject(
              error?.details
            )
        }
      ],

      warnings:
        validation.warnings
    };
  }


  /*
   * STEP 4
   * ------
   * Server accounting-period control.
   *
   * UI state is never authoritative.
   */
  try {

    await assertFinancialPeriodOpen({
      financialDocument:
        validation.normalized,

      entityPassportId:
        command.entityPassportId
    });

  } catch (
    error
  ) {

    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "period-control",

      financialDocument:
        validation.normalized,

      errors: [
        {
          name:
            clean(
              error?.name ||
              "IXIFinancialPeriodControlError"
            ),

          message:
            clean(
              error?.message ||
              "Financial accounting period control failed."
            ),

          details:
            safeObject(
              error?.details
            )
        }
      ],

      warnings:
        validation.warnings
    };
  }


  /*
   * STEP 4
   * ------
   * Persist through Provider Service.
   */
  const created =
    await providerService
      .createDocument({
        financialDocument:
          validation.normalized,

        actorPassportId:
          command.actorPassportId,

        entityPassportId:
          command.entityPassportId,

        commandId:
          command.commandId,

        idempotencyKey:
          command.idempotencyKey,

        requestId:
          command.requestId,

        source:
          command.source,

        metadata: {
          ...command.metadata,

          commandEngine:
            "IXIFinancialCommandEngine",

          commandDocumentType:
            command.documentType
        }
      });


  if (
    !created.ok
  ) {

    return {
      ok:
        false,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "persistence",

      financialDocument:
        validation.normalized,

      persistence:
        created,

      errors:
        created.errors,

      warnings:
        created.warnings
    };
  }


  /*
   * STEP 4
   * ------
   * Refresh AOF2 financial snapshot.
   */
  let snapshot =
    null;


  try {

    snapshot =
      await createCommandSnapshot({
        financialDocument:
          created
            .data
            ?.record
            ?.financialDocument ||
          validation.normalized,

        snapshot:
          command.snapshot
      });

  } catch (
    error
  ) {

    /*
     * Document is already durably persisted.
     *
     * Snapshot failure must NOT pretend the
     * document creation failed.
     */

    return {
      ok:
        true,

      commandId:
        command.commandId,

      idempotencyKey:
        command.idempotencyKey,

      stage:
        "complete-with-snapshot-warning",

      financialDocument:
        created
          .data
          ?.record
          ?.financialDocument ||
        validation.normalized,

      persistence:
        created,

      snapshot:
        null,

      warnings: [
        ...safeArray(
          created.warnings
        ),

        {
          name:
            clean(
              error?.name ||
              "IXIFinancialSnapshotRefreshError"
            ),

          message:
            clean(
              error?.message ||
              "Financial document persisted but snapshot refresh failed."
            )
        }
      ],

      errors:
        []
    };
  }


  /*
   * STEP 5
   * ------
   * Command complete.
   */

  return {
    ok:
      true,

    commandId:
      command.commandId,

    idempotencyKey:
      command.idempotencyKey,

    stage:
      "complete",

    documentType:
      command.documentType,

    financialDocument:
      created
        .data
        ?.record
        ?.financialDocument ||
      validation.normalized,

    record:
      created
        .data
        ?.record ||
      null,

    created:
      created
        .data
        ?.created ===
          true,

    idempotentReplay:
      created
        .data
        ?.idempotentReplay ===
          true,

    indexedPassportIds:
      safeArray(
        created
          .data
          ?.indexedPassportIds
      ),

    storageProvider:
      clean(
        created
          .data
          ?.storageProvider
      ),

    snapshot,

    warnings: [
      ...safeArray(
        validation.warnings
      ),

      ...safeArray(
        created.warnings
      )
    ],

    errors:
      []
  };
}


/* =========================================================
   POST JOURNAL ENTRY COMMAND
   ========================================================= */

async function executePostJournalEntryCommand(
  input = {}
) {
  const commandId =
    clean(
      input.commandId
    ) ||
    createFinancialCommandId();

  const idempotencyKey =
    clean(
      input.idempotencyKey
    ) ||
    createFinancialIdempotencyKey();

  try {
    return await postJournalEntry({
      ...safeObject(
        input
      ),

      commandId,
      idempotencyKey
    }, {
      loadDocument:
        financialStore
          .getCurrentDocumentRecord,

      loadIdempotency:
        financialStore
          .getIdempotencyRecord,

      replaceDocument:
        providerService
          .replaceDocument,

      validateAccounts:
        validateJournalAccounts,

      assertPeriodOpen:
        assertFinancialPeriodOpen
    });

  } catch (
    error
  ) {
    return {
      ok:
        false,

      operation:
        "financial.journal.post",

      commandId,
      idempotencyKey,

      errors: [
        {
          name:
            clean(
              error?.name ||
              "IXIFinancialJournalPostError"
            ),

          message:
            clean(
              error?.message ||
              "Journal entry could not be posted."
            ),

          details:
            safeObject(
              error?.details
            )
        }
      ],

      warnings:
        []
    };
  }
}


/* =========================================================
   CLOSE ACCOUNTING PERIOD COMMAND
   ========================================================= */

async function executeCloseFinancialPeriodCommand(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const entityPassportId =
    clean(
      source.entityPassportId
    );


  const actorPassportId =
    clean(
      source.actorPassportId
    );


  const period =
    clean(
      source.period
    );


  const currency =
    clean(
      source.currency ||
      "USD"
    ).toUpperCase();


  const commandId =
    clean(
      source.commandId
    ) ||
    createFinancialCommandId();


  const idempotencyKey =
    clean(
      source.idempotencyKey
    ) ||
    createFinancialIdempotencyKey();


  if (!entityPassportId) {
    return {
      ok:
        false,

      stage:
        "close-control",

      commandId,
      idempotencyKey,

      errors: [
        {
          name:
            "IXIFinancialEntityRequiredError",

          message:
            "Accounting period close requires entityPassportId."
        }
      ],

      warnings:
        []
    };
  }


  if (!actorPassportId) {
    return {
      ok:
        false,

      stage:
        "close-control",

      commandId,
      idempotencyKey,

      errors: [
        {
          name:
            "IXIFinancialActorRequiredError",

          message:
            "Accounting period close requires actorPassportId."
        }
      ],

      warnings:
        []
    };
  }


  if (
    !/^\d{4}-\d{2}$/.test(
      period
    )
  ) {
    return {
      ok:
        false,

      stage:
        "close-control",

      commandId,
      idempotencyKey,

      errors: [
        {
          name:
            "IXIFinancialPeriodCloseError",

          message:
            "Accounting period close requires period in YYYY-MM format."
        }
      ],

      warnings:
        []
    };
  }


  /*
   * STEP 1
   * ------
   * Load authoritative Entity accounting truth.
   */

  let gl;


  try {

    gl =
      await getFinancialGLProjection({
        entityPassportId,
        period,
        currency
      });

  } catch (
    error
  ) {

    return {
      ok:
        false,

      stage:
        "close-read",

      commandId,
      idempotencyKey,

      errors: [
        {
          name:
            clean(
              error?.name ||
              "IXIFinancialPeriodCloseReadError"
            ),

          message:
            clean(
              error?.message ||
              "Accounting period close could not read authoritative GL."
            ),

          details:
            safeObject(
              error?.details
            )
        }
      ],

      warnings:
        []
    };
  }


  const projection =
    safeObject(
      gl?.projection
    );


  const periodState =
    safeObject(
      projection.period
    );


  /*
   * Idempotent close semantics:
   *
   * If this period is already closed, do not
   * manufacture another close document.
   */

  if (
    periodState.closed ===
      true
  ) {
    return {
      ok:
        true,

      stage:
        "already-closed",

      commandId,
      idempotencyKey,

      closed:
        true,

      created:
        false,

      idempotentReplay:
        true,

      closeDocumentId:
        clean(
          periodState.closeDocumentId
        ),

      period:
        periodState,

      projection,

      storageProvider:
        clean(
          gl?.storageProvider
        ),

      warnings:
        [],

      errors:
        []
    };
  }


  /*
   * STEP 2
   * ------
   * Authoritative close readiness.
   */

  const controls =
    safeObject(
      projection.controls
    );


  const periodTrialBalance =
    safeObject(
      projection.trialBalance
    );


  const endingTrialBalance =
    safeObject(
      projection.endingTrialBalance
    );


  const balanceSheet =
    safeObject(
      projection.balanceSheet
    );


  const closeChecks = [
    {
      key:
        "period-trial-balance-balanced",

      label:
        "Period Trial Balance Balanced",

      ok:
        periodTrialBalance.balanced ===
          true
    },

    {
      key:
        "ending-trial-balance-balanced",

      label:
        "Ending Trial Balance Balanced",

      ok:
        endingTrialBalance.balanced ===
          true
    },

    {
      key:
        "balance-sheet-balanced",

      label:
        "Balance Sheet Balanced",

      ok:
        balanceSheet.balanced ===
          true
    },

    {
      key:
        "period-posting-exceptions",

      label:
        "No Period Posting Exceptions",

      ok:
        Number(
          controls.postingExceptions ||
          0
        ) ===
          0
    },

    {
      key:
        "ending-posting-exceptions",

      label:
        "No Ending Posting Exceptions",

      ok:
        Number(
          controls.endingPostingExceptions ||
          0
        ) ===
          0
    },

    {
      key:
        "gl-ready",

      label:
        "General Ledger Ready",

      ok:
        controls.ready ===
          true
    }
  ];


  const failedChecks =
    closeChecks.filter(
      check =>
        check.ok !==
          true
    );


  if (
    failedChecks.length
  ) {
    return {
      ok:
        false,

      stage:
        "close-readiness",

      commandId,
      idempotencyKey,

      period,

      currency,

      closeChecks,

      failedChecks,

      projection,

      errors: [
        {
          name:
            "IXIFinancialPeriodCloseReadinessError",

          message:
            `Accounting period ${period} failed ${failedChecks.length} close control(s).`,

          details: {
            failedChecks
          }
        }
      ],

      warnings:
        []
    };
  }


  /*
   * STEP 3
   * ------
   * Persist immutable close evidence.
   *
   * Use the ENDING Trial Balance because close
   * evidence describes the accounting position
   * at period end, not only current-period activity.
   */

  const closeDate =
    `${period}-01`;


  const year =
    Number(
      period.slice(
        0,
        4
      )
    );


  const month =
    Number(
      period.slice(
        5,
        7
      )
    );


  const lastDay =
    new Date(
      Date.UTC(
        year,
        month,
        0
      )
    )
      .toISOString()
      .slice(
        0,
        10
      );


  const created =
    await executeCreateFinancialDocumentCommand(
      {
        documentType:
          "period-close",

        actorPassportId,

        entityPassportId,

        commandId,

        idempotencyKey,

        requestId:
          clean(
            source.requestId
          ),

        source:
          "ixi-transact-period-close",

        metadata: {
          ...safeObject(
            source.metadata
          ),

          transactSurface:
            "desktop",

          accountingScope:
            "entity",

          periodControl:
            "close"
        },

        input: {
          documentNumber:
            `CLOSE-${period}`,

          documentDate:
            lastDay,

          occurredAt:
            lastDay,

          period,

          currency,

          financialState:
            "closed",

          status:
            "closed",

          closedAt:
            new Date()
              .toISOString(),

          closedBy:
            actorPassportId,

          trialBalance:
            safeArray(
              endingTrialBalance.rows
            ),

          closeChecks,

          postingRuleVersion:
            "ixi-period-close-v1",

          references: [
            {
              role:
                "entity",

              passportId:
                entityPassportId,

              label:
                clean(
                  source.entityLabel ||
                  entityPassportId
                )
            }
          ],

          sourceSystem:
            "ixi-transact-general-ledger",

          metadata: {
            accountingControlDocument:
              true,

            closeCommandVersion:
              "ixi-period-close-command-v1",

            periodTrialBalance:
              periodTrialBalance,

            endingTrialBalance:
              endingTrialBalance,

            profitAndLoss:
              safeObject(
                projection
                  .profitAndLoss
              ),

            cumulativeProfitAndLoss:
              safeObject(
                projection
                  .cumulativeProfitAndLoss
              ),

            balanceSheet:
              balanceSheet,

            controls:
              controls
          }
        }
      },
      {
        allowPeriodControl:
          true
      }
    );


  if (
    !created.ok
  ) {
    return {
      ...created,

      stage:
        created.stage ||
        "close-persistence"
    };
  }


  /*
   * STEP 4
   * ------
   * Re-read accounting truth and prove the
   * period transitioned to CLOSED.
   */

  const verified =
    await getFinancialGLProjection({
      entityPassportId,
      period,
      currency
    });


  const verifiedPeriod =
    safeObject(
      verified
        ?.projection
        ?.period
    );


  if (
    verifiedPeriod.closed !==
      true
  ) {
    return {
      ok:
        false,

      stage:
        "close-verification",

      commandId,
      idempotencyKey,

      financialDocument:
        created.financialDocument,

      errors: [
        {
          name:
            "IXIFinancialPeriodCloseVerificationError",

          message:
            `Period Close persisted but ${period} did not resolve as closed.`
        }
      ],

      warnings:
        safeArray(
          created.warnings
        )
    };
  }


  return {
    ok:
      true,

    stage:
      "complete",

    commandId,
    idempotencyKey,

    created:
      created.created ===
        true,

    idempotentReplay:
      created.idempotentReplay ===
        true,

    documentType:
      "period-close",

    financialDocument:
      created.financialDocument,

    record:
      created.record,

    closeDocumentId:
      clean(
        created
          ?.financialDocument
          ?.financialDocumentId
      ),

    period:
      verifiedPeriod,

    closeChecks,

    storageProvider:
      clean(
        created.storageProvider ||
        verified.storageProvider
      ),

    projection:
      verified.projection,

    warnings:
      safeArray(
        created.warnings
      ),

    errors:
      []
  };
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  createFinancialCommandId,
  createFinancialIdempotencyKey,

  normalizeFinancialCreateCommand,

  inferPrimaryPassportId,

  createCommandSnapshot,

  resolveFinancialDocumentPeriod,
  hasEconomicValue,
  isNonEconomicOperationalWorkOrder,
  isNonEconomicOperationalCapture,
  assertFinancialPeriodOpen,
  validateJournalAccounts,

  executeCreateFinancialDocumentCommand,
  executePostJournalEntryCommand,
  executeCloseFinancialPeriodCommand
};
