"use strict";

/*
 * IXI FINANCIAL AUTHORIZED SERVICE
 *
 * PURPOSE
 * -------
 *
 * Security boundary immediately above the
 * core IXIFinancialService.
 *
 *
 * FLOW
 * ----
 *
 * trusted access context
 *       ↓
 * permission decision
 *       ↓
 * financial service
 *
 *
 * CORE RULE
 * ---------
 *
 * IXIFinancialService owns financial work.
 *
 * IXIFinancialAuthorizedService owns whether
 * the caller may request that work.
 *
 *
 * NO CLIENT-SUPPLIED ROLE / PERMISSION DATA
 * IS TRUSTED HERE.
 */


const financialService =
  require(
    "./IXIFinancialProviderService"
  );


const {
  IXI_FINANCIAL_ACTIONS,

  normalizeFinancialAccessContext,

  isFinancialAdmin,

  canAccessFinancialPassport,

  authorizeFinancialAction,

  authorizeFinancialDocumentWrite,

  getFinancialDocumentPassportIds
} =
  require(
    "./IXIFinancialPermissionEngine"
  );


const {
  createFinancialEnvelope
} =
  require(
    "./IXIFinancialServerContract"
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
    typeof value ===
      "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


/* =========================================================
   DENIAL ENVELOPE
   ========================================================= */

function createAuthorizationFailure({
  accessContext = {},
  operation = "",
  action = "",
  reason = "permission-denied",
  requestId = "",
  details = {}
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );


  const unauthenticated =
    !context.authenticated ||
    reason ===
      "unauthenticated";


  return createFinancialEnvelope({
    ok:
      false,

    operation,

    requestId,

    errors: [
      {
        name:
          unauthenticated
            ? "IXIFinancialAuthenticationError"
            : "IXIFinancialAuthorizationError",

        message:
          unauthenticated
            ? "Financial authentication required."
            : "Financial permission denied.",

        details: {
          reason,

          action:
            clean(
              action
            ),

          actorPassportId:
            context.actorPassportId,

          ...safeObject(
            details
          )
        }
      }
    ]
  });
}


/* =========================================================
   BASIC ACTION AUTHORIZATION
   ========================================================= */

function authorizeAction({
  accessContext = {},
  action = "",
  operation = "",
  requestId = ""
} = {}) {
  const result =
    authorizeFinancialAction({
      accessContext,
      action
    });


  if (
    result.allowed
  ) {
    return null;
  }


  return createAuthorizationFailure({
    accessContext,

    operation,

    action,

    requestId,

    reason:
      result.reason
  });
}


/* =========================================================
   PASSPORT READ AUTHORIZATION
   ========================================================= */

function authorizePassportRead({
  accessContext = {},
  action = "",
  passportId = "",
  operation = "",
  requestId = ""
} = {}) {
  const actionFailure =
    authorizeAction({
      accessContext,
      action,
      operation,
      requestId
    });


  if (
    actionFailure
  ) {
    return actionFailure;
  }


  if (
    !canAccessFinancialPassport({
      accessContext,

      passportId
    })
  ) {
    return createAuthorizationFailure({
      accessContext,

      operation,

      action,

      requestId,

      reason:
        "passport-scope-denied",

      details: {
        passportId:
          clean(
            passportId
          )
      }
    });
  }


  return null;
}


/* =========================================================
   DOCUMENT READ SCOPE
   ========================================================= */

/*
 * READ RULE
 * ---------
 *
 * User needs:
 *
 * 1. action permission
 *
 * AND
 *
 * 2. access to at least ONE Passport attached
 *    to the document.
 *
 *
 * Why not every Passport?
 *
 * An expense might reference:
 *
 * machine
 * job
 * vendor
 * employee
 *
 * A mechanic who legitimately works on the
 * machine should not need management rights
 * over the vendor Passport merely to view
 * the machine's financial record.
 *
 *
 * ADMIN bypasses Passport-scope filtering.
 */

function authorizeDocumentRead({
  accessContext = {},
  action = "",
  record = null,
  operation = "",
  requestId = ""
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );


  const actionFailure =
    authorizeAction({
      accessContext:
        context,

      action,

      operation,

      requestId
    });


  if (
    actionFailure
  ) {
    return actionFailure;
  }


  if (
    isFinancialAdmin(
      context
    )
  ) {
    return null;
  }


  const document =
    safeObject(
      record
        ?.financialDocument
    );


  const passportIds =
    getFinancialDocumentPassportIds(
      document
    );


  const entityPassportId =
    clean(
      record
        ?.server
        ?.entityPassportId
    );


  const entityMatch =
    Boolean(
      entityPassportId &&
      entityPassportId ===
        context.entityPassportId
    );


  const passportMatch =
    passportIds.some(
      passportId =>
        canAccessFinancialPassport({
          accessContext:
            context,

          passportId
        })
    );


  if (
    entityMatch ||
    passportMatch
  ) {
    return null;
  }


  return createAuthorizationFailure({
    accessContext:
      context,

    operation,

    action,

    requestId,

    reason:
      "document-scope-denied",

    details: {
      financialDocumentId:
        clean(
          document
            ?.financialDocumentId
        ),

      documentPassportIds:
        passportIds
    }
  });
}


/* =========================================================
   CREATE DOCUMENT
   ========================================================= */

function createDocument(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const operation =
    "financial.document.create";


  const action =
    IXI_FINANCIAL_ACTIONS
      .CREATE_DOCUMENT;


  const authorization =
    authorizeFinancialDocumentWrite({
      accessContext,

      action,

      financialDocument:
        source.financialDocument ||
        source.document
    });


  if (
    !authorization.allowed
  ) {
    return createAuthorizationFailure({
      accessContext,

      operation,

      action,

      requestId:
        source.requestId,

      reason:
        authorization.reason,

      details:
        authorization
    });
  }


  /*
   * Actor identity comes from trusted
   * accessContext, NOT request body.
   */
  return financialService
    .createDocument({
      ...source,

      actorPassportId:
        accessContext
          .actorPassportId,

      entityPassportId:
        accessContext
          .entityPassportId
    });
}


/* =========================================================
   REPLACE DOCUMENT
   ========================================================= */

function replaceDocument(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const operation =
    "financial.document.replace";


  const action =
    IXI_FINANCIAL_ACTIONS
      .REPLACE_DOCUMENT;


  const authorization =
    authorizeFinancialDocumentWrite({
      accessContext,

      action,

      financialDocument:
        source.financialDocument ||
        source.document
    });


  if (
    !authorization.allowed
  ) {
    return createAuthorizationFailure({
      accessContext,

      operation,

      action,

      requestId:
        source.requestId,

      reason:
        authorization.reason,

      details:
        authorization
    });
  }


  return financialService
    .replaceDocument({
      ...source,

      actorPassportId:
        accessContext
          .actorPassportId
    });
}


/* =========================================================
   PATCH DOCUMENT
   ========================================================= */

async function patchDocument(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const financialDocumentId =
    clean(
      source.financialDocumentId
    );


  const operation =
    "financial.document.patch";


  const action =
    IXI_FINANCIAL_ACTIONS
      .PATCH_DOCUMENT;


  const existing =
    (
      await financialService
        .getDocument({
          financialDocumentId,

          requestId:
            source.requestId
        })
    )?.data?.record ||
    null;


  /*
   * Let core service return canonical 404.
   */
  if (
    !existing
  ) {
    const permissionFailure =
      authorizeAction({
        accessContext,

        action,

        operation,

        requestId:
          source.requestId
      });


    if (
      permissionFailure
    ) {
      return permissionFailure;
    }


    return financialService
      .patchDocument({
        ...source,

        actorPassportId:
          accessContext
            .actorPassportId
      });
  }


  const mergedDocument = {
    ...safeObject(
      existing
        .financialDocument
    ),

    ...safeObject(
      source.patch
    ),

    financialDocumentId
  };


  const authorization =
    authorizeFinancialDocumentWrite({
      accessContext,

      action,

      financialDocument:
        mergedDocument
    });


  if (
    !authorization.allowed
  ) {
    return createAuthorizationFailure({
      accessContext,

      operation,

      action,

      requestId:
        source.requestId,

      reason:
        authorization.reason,

      details:
        authorization
    });
  }


  return financialService
    .patchDocument({
      ...source,

      actorPassportId:
        accessContext
          .actorPassportId
    });
}


/* =========================================================
   GET DOCUMENT
   ========================================================= */

async function getDocument(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const financialDocumentId =
    clean(
      source.financialDocumentId
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const operation =
    "financial.document.get";


  const action =
    IXI_FINANCIAL_ACTIONS
      .VIEW_DOCUMENT;


  const record =
    (
      await financialService
        .getDocument({
          financialDocumentId,

          requestId:
            source.requestId
        })
    )?.data?.record ||
    null;


  if (
    record
  ) {
    const failure =
      authorizeDocumentRead({
        accessContext,

        action,

        record,

        operation,

        requestId:
          source.requestId
      });


    if (
      failure
    ) {
      return failure;
    }
  } else {
    const failure =
      authorizeAction({
        accessContext,

        action,

        operation,

        requestId:
          source.requestId
      });


    if (
      failure
    ) {
      return failure;
    }
  }


  return financialService
    .getDocument(
      source
    );
}


/* =========================================================
   HISTORY
   ========================================================= */

async function getDocumentHistory(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const financialDocumentId =
    clean(
      source.financialDocumentId
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const operation =
    "financial.document.history";


  const action =
    IXI_FINANCIAL_ACTIONS
      .VIEW_HISTORY;


  const record =
    (
      await financialService
        .getDocument({
          financialDocumentId,

          requestId:
            source.requestId
        })
    )?.data?.record ||
    null;


  if (
    record
  ) {
    const failure =
      authorizeDocumentRead({
        accessContext,

        action,

        record,

        operation,

        requestId:
          source.requestId
      });


    if (
      failure
    ) {
      return failure;
    }
  } else {
    const failure =
      authorizeAction({
        accessContext,

        action,

        operation,

        requestId:
          source.requestId
      });


    if (
      failure
    ) {
      return failure;
    }
  }


  return financialService
    .getDocumentHistory(
      source
    );
}


/* =========================================================
   PASSPORT DOCUMENT LIST
   ========================================================= */

function listDocumentsByPassport(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const failure =
    authorizePassportRead({
      accessContext,

      action:
        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_DOCUMENTS,

      passportId:
        source.passportId,

      operation:
        "financial.passport.documents",

      requestId:
        source.requestId
    });


  if (
    failure
  ) {
    return failure;
  }


  return financialService
    .listDocumentsByPassport(
      source
    );
}


/* =========================================================
   PASSPORT SNAPSHOT
   ========================================================= */

function getPassportSnapshot(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const failure =
    authorizePassportRead({
      accessContext,

      action:
        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_SNAPSHOT,

      passportId:
        source.passportId,

      operation:
        "financial.passport.snapshot",

      requestId:
        source.requestId
    });


  if (
    failure
  ) {
    return failure;
  }


  return financialService
    .getPassportSnapshot(
      source
    );
}


/* =========================================================
   RECURSIVE SCOPE SNAPSHOT
   ========================================================= */

function getScopeSnapshot(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  const accessContext =
    normalizeFinancialAccessContext(
      source.accessContext
    );


  const operation =
    "financial.scope.snapshot";


  const action =
    IXI_FINANCIAL_ACTIONS
      .VIEW_SCOPE_SNAPSHOT;


  const actionFailure =
    authorizeAction({
      accessContext,

      action,

      operation,

      requestId:
        source.requestId
    });


  if (
    actionFailure
  ) {
    return actionFailure;
  }


  if (
    !isFinancialAdmin(
      accessContext
    )
  ) {
    const requestedPassportIds =
      Array.from(
        new Set(
          [
            clean(
              source.rootPassportId
            ),

            ...safeArray(
              source.scopePassportIds
            )
          ]
            .filter(
              Boolean
            )
        )
      );


    const inaccessible =
      requestedPassportIds.filter(
        passportId =>
          !canAccessFinancialPassport({
            accessContext,

            passportId
          })
      );


    if (
      inaccessible.length
    ) {
      return createAuthorizationFailure({
        accessContext,

        operation,

        action,

        requestId:
          source.requestId,

        reason:
          "scope-passport-denied",

        details: {
          inaccessiblePassportIds:
            inaccessible
        }
      });
    }
  }


  return financialService
    .getScopeSnapshot(
      source
    );
}


/* =========================================================
   HEALTH
   ========================================================= */

/*
 * Health is intentionally public.
 *
 * It exposes service capability state,
 * not Financial Documents.
 */

function getHealth() {
  return financialService
    .getHealth();
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  createAuthorizationFailure,

  authorizeAction,
  authorizePassportRead,
  authorizeDocumentRead,

  createDocument,
  replaceDocument,
  patchDocument,

  getDocument,
  getDocumentHistory,

  listDocumentsByPassport,
  getPassportSnapshot,
  getScopeSnapshot,

  getHealth
};
