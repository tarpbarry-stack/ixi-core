"use strict";

/*
 * IXI FINANCIAL PERMISSION ENGINE
 *
 * PURPOSE
 * -------
 *
 * Canonical authorization policy for the
 * IXI Financial subsystem.
 *
 *
 * CORE RULE
 * ---------
 *
 * Authentication answers:
 *
 *   WHO ARE YOU?
 *
 * Authorization answers:
 *
 *   WHAT MAY YOU DO?
 *
 *
 * THIS ENGINE OWNS AUTHORIZATION.
 *
 * Routes do not decide permissions.
 * Persistence does not decide permissions.
 * AOF2 does not decide permissions.
 *
 *
 * IMPORTANT
 * ---------
 *
 * This file intentionally works from a
 * resolved actor-access context.
 *
 * It does NOT yet authenticate tokens.
 *
 * Future auth middleware resolves:
 *
 * {
 *   actorPassportId,
 *   entityPassportId,
 *   roles,
 *   permissions,
 *   managedPassportIds
 * }
 *
 * and passes that context here.
 */


/* =========================================================
   ACTIONS
   ========================================================= */

const IXI_FINANCIAL_ACTIONS =
  Object.freeze({
    VIEW_DOCUMENT:
      "financial.document.view",

    CREATE_DOCUMENT:
      "financial.document.create",

    REPLACE_DOCUMENT:
      "financial.document.replace",

    PATCH_DOCUMENT:
      "financial.document.patch",

    POST_DOCUMENT:
      "financial.document.post",

    APPROVE_DOCUMENT:
      "financial.document.approve",

    REJECT_DOCUMENT:
      "financial.document.reject",

    VOID_DOCUMENT:
      "financial.document.void",

    REVERSE_DOCUMENT:
      "financial.document.reverse",

    VIEW_GENERAL_LEDGER:
      "financial.gl.view",

    CREATE_JOURNAL:
      "financial.gl.journal.create",

    POST_JOURNAL:
      "financial.gl.journal.post",

    REVERSE_JOURNAL:
      "financial.gl.journal.reverse",

    CLOSE_PERIOD:
      "financial.gl.period.close",

    REOPEN_PERIOD:
      "financial.gl.period.reopen",

    MANAGE_POSTING_RULES:
      "financial.gl.posting-rules.manage",

    VIEW_FINANCIAL_REPORTS:
      "financial.reporting.view",

    RECORD_PAYMENT:
      "financial.payment.create",

    APPLY_VENDOR_CREDIT:
      "financial.vendor-credit.apply",

    SCHEDULE_PAYMENT:
      "financial.payment.schedule",

    MANAGE_PAYABLES:
      "financial.payables.manage",

    MANAGE_TREASURY:
      "financial.treasury.manage",

    POST_TREASURY_MOVEMENT:
      "financial.treasury.movement.post",

    RECONCILE_TREASURY:
      "financial.treasury.reconcile",

    VIEW_HISTORY:
      "financial.document.history.view",

    VIEW_AUDIT:
      "financial.audit.view",

    VIEW_PASSPORT_DOCUMENTS:
      "financial.passport.documents.view",

    VIEW_PASSPORT_SNAPSHOT:
      "financial.passport.snapshot.view",

    VIEW_SCOPE_SNAPSHOT:
      "financial.scope.snapshot.view",

    EXPORT:
      "financial.export",

    ADMIN:
      "financial.admin"
  });


/* =========================================================
   STANDARD ROLES
   ========================================================= */

const IXI_FINANCIAL_ROLES =
  Object.freeze({
    VIEWER:
      "financial-viewer",

    EMPLOYEE:
      "financial-employee",

    MANAGER:
      "financial-manager",

    ACCOUNTING:
      "financial-accounting",

    CONTROLLER:
      "financial-controller",

    ADMIN:
      "financial-admin"
  });


/* =========================================================
   ROLE CAPABILITIES
   ========================================================= */

const ROLE_PERMISSIONS =
  Object.freeze({

    [IXI_FINANCIAL_ROLES.VIEWER]:
      Object.freeze([
        IXI_FINANCIAL_ACTIONS
          .VIEW_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_DOCUMENTS,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_SNAPSHOT
      ]),


    [IXI_FINANCIAL_ROLES.EMPLOYEE]:
      Object.freeze([
        IXI_FINANCIAL_ACTIONS
          .VIEW_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .CREATE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .PATCH_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_DOCUMENTS,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_SNAPSHOT
      ]),


    [IXI_FINANCIAL_ROLES.MANAGER]:
      Object.freeze([
        IXI_FINANCIAL_ACTIONS
          .VIEW_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .CREATE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .REPLACE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .PATCH_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .APPROVE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .REJECT_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_HISTORY,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_DOCUMENTS,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_SNAPSHOT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_SCOPE_SNAPSHOT
      ]),


    [IXI_FINANCIAL_ROLES.ACCOUNTING]:
      Object.freeze([
        IXI_FINANCIAL_ACTIONS
          .VIEW_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .CREATE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .REPLACE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .PATCH_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .POST_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .APPROVE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .REJECT_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .VOID_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .REVERSE_DOCUMENT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_GENERAL_LEDGER,

        IXI_FINANCIAL_ACTIONS
          .CREATE_JOURNAL,

        IXI_FINANCIAL_ACTIONS
          .POST_JOURNAL,

        IXI_FINANCIAL_ACTIONS
          .REVERSE_JOURNAL,

        IXI_FINANCIAL_ACTIONS
          .VIEW_FINANCIAL_REPORTS,

        IXI_FINANCIAL_ACTIONS
          .RECORD_PAYMENT,

        IXI_FINANCIAL_ACTIONS
          .APPLY_VENDOR_CREDIT,

        IXI_FINANCIAL_ACTIONS
          .SCHEDULE_PAYMENT,

        IXI_FINANCIAL_ACTIONS
          .MANAGE_PAYABLES,

        IXI_FINANCIAL_ACTIONS
          .MANAGE_TREASURY,

        IXI_FINANCIAL_ACTIONS
          .POST_TREASURY_MOVEMENT,

        IXI_FINANCIAL_ACTIONS
          .RECONCILE_TREASURY,

        IXI_FINANCIAL_ACTIONS
          .VIEW_HISTORY,

        IXI_FINANCIAL_ACTIONS
          .VIEW_AUDIT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_DOCUMENTS,

        IXI_FINANCIAL_ACTIONS
          .VIEW_PASSPORT_SNAPSHOT,

        IXI_FINANCIAL_ACTIONS
          .VIEW_SCOPE_SNAPSHOT,

        IXI_FINANCIAL_ACTIONS
          .EXPORT
      ]),


    [IXI_FINANCIAL_ROLES.CONTROLLER]:
      Object.freeze(
        Object.values(
          IXI_FINANCIAL_ACTIONS
        ).filter(
          action =>
            action !==
              IXI_FINANCIAL_ACTIONS.ADMIN
        )
      ),


    [IXI_FINANCIAL_ROLES.ADMIN]:
      Object.freeze(
        Object.values(
          IXI_FINANCIAL_ACTIONS
        )
      )
  });


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


function uniqueStrings(
  values
) {
  return Array.from(
    new Set(
      safeArray(
        values
      )
        .map(
          clean
        )
        .filter(
          Boolean
        )
    )
  );
}


/* =========================================================
   ACTOR ACCESS CONTEXT
   ========================================================= */

function normalizeFinancialAccessContext(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  return {
    actorPassportId:
      clean(
        source.actorPassportId
      ),

    entityPassportId:
      clean(
        source.entityPassportId
      ),

    roles:
      uniqueStrings(
        source.roles
      ),

    permissions:
      uniqueStrings(
        source.permissions
      ),

    managedPassportIds:
      uniqueStrings(
        source.managedPassportIds
      ),

    deniedPermissions:
      uniqueStrings(
        source.deniedPermissions
      ),

    authenticated:
      source.authenticated ===
        undefined
        ? Boolean(
            clean(
              source.actorPassportId
            )
          )
        : Boolean(
            source.authenticated
          ),

    metadata: {
      ...safeObject(
        source.metadata
      )
    }
  };
}


/* =========================================================
   ROLE PERMISSION EXPANSION
   ========================================================= */

function getRolePermissions(
  roles = []
) {
  const permissions =
    new Set();

  uniqueStrings(
    roles
  ).forEach(
    role => {
      safeArray(
        ROLE_PERMISSIONS[
          role
        ]
      ).forEach(
        permission =>
          permissions.add(
            permission
          )
      );
    }
  );

  return Array.from(
    permissions
  );
}


/* =========================================================
   EFFECTIVE PERMISSIONS
   ========================================================= */

function getEffectiveFinancialPermissions(
  accessContext = {}
) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );

  const granted =
    new Set([
      ...getRolePermissions(
        context.roles
      ),

      ...context.permissions
    ]);

  context
    .deniedPermissions
    .forEach(
      permission =>
        granted.delete(
          permission
        )
    );

  return Array.from(
    granted
  );
}


/* =========================================================
   ADMIN CHECK
   ========================================================= */

function isFinancialAdmin(
  accessContext = {}
) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );

  const permissions =
    getEffectiveFinancialPermissions(
      context
    );

  return (
    context.roles.includes(
      IXI_FINANCIAL_ROLES.ADMIN
    ) ||
    permissions.includes(
      IXI_FINANCIAL_ACTIONS.ADMIN
    )
  );
}


/* =========================================================
   PASSPORT SCOPE CHECK
   ========================================================= */

function canAccessFinancialPassport({
  accessContext = {},
  passportId = ""
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );

  const targetPassportId =
    clean(
      passportId
    );

  if (
    !targetPassportId
  ) {
    return false;
  }

  if (
    isFinancialAdmin(
      context
    )
  ) {
    return true;
  }

  if (
    targetPassportId ===
      context.actorPassportId
  ) {
    return true;
  }

  if (
    targetPassportId ===
      context.entityPassportId
  ) {
    return true;
  }

  return context
    .managedPassportIds
    .includes(
      targetPassportId
    );
}


/* =========================================================
   PERMISSION CHECK
   ========================================================= */

function hasFinancialPermission({
  accessContext = {},
  action = ""
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );

  const resolvedAction =
    clean(
      action
    );

  if (
    !context.authenticated
  ) {
    return false;
  }

  if (
    !resolvedAction
  ) {
    return false;
  }

  if (
    isFinancialAdmin(
      context
    )
  ) {
    return true;
  }

  return getEffectiveFinancialPermissions(
    context
  ).includes(
    resolvedAction
  );
}


/* =========================================================
   AUTHORIZATION RESULT
   ========================================================= */

function authorizeFinancialAction({
  accessContext = {},
  action = "",
  targetPassportId = "",
  requirePassportScope = false
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );

  const resolvedAction =
    clean(
      action
    );

  const resolvedTarget =
    clean(
      targetPassportId
    );


  if (
    !context.authenticated
  ) {
    return {
      allowed:
        false,

      reason:
        "unauthenticated",

      action:
        resolvedAction,

      actorPassportId:
        context.actorPassportId,

      targetPassportId:
        resolvedTarget
    };
  }


  if (
    !hasFinancialPermission({
      accessContext:
        context,

      action:
        resolvedAction
    })
  ) {
    return {
      allowed:
        false,

      reason:
        "permission-denied",

      action:
        resolvedAction,

      actorPassportId:
        context.actorPassportId,

      targetPassportId:
        resolvedTarget
    };
  }


  if (
    requirePassportScope &&
    !canAccessFinancialPassport({
      accessContext:
        context,

      passportId:
        resolvedTarget
    })
  ) {
    return {
      allowed:
        false,

      reason:
        "passport-scope-denied",

      action:
        resolvedAction,

      actorPassportId:
        context.actorPassportId,

      targetPassportId:
        resolvedTarget
    };
  }


  return {
    allowed:
      true,

    reason:
      "allowed",

    action:
      resolvedAction,

    actorPassportId:
      context.actorPassportId,

    targetPassportId:
      resolvedTarget
  };
}


/* =========================================================
   ASSERT
   ========================================================= */

function assertFinancialPermission({
  accessContext = {},
  action = "",
  targetPassportId = "",
  requirePassportScope = false
} = {}) {
  const result =
    authorizeFinancialAction({
      accessContext,
      action,
      targetPassportId,
      requirePassportScope
    });

  if (
    !result.allowed
  ) {
    const error =
      new Error(
        `Financial permission denied: ${result.reason}: ${result.action}`
      );

    error.name =
      result.reason ===
        "unauthenticated"
        ? "IXIFinancialAuthenticationError"
        : "IXIFinancialAuthorizationError";

    error.details =
      result;

    throw error;
  }

  return result;
}


/* =========================================================
   DOCUMENT TARGET PASSPORTS
   ========================================================= */

function getFinancialDocumentPassportIds(
  financialDocument = {}
) {
  const source =
    safeObject(
      financialDocument
    );

  const passportIds =
    new Set();


  function collect(
    references
  ) {
    safeArray(
      references
    ).forEach(
      reference => {
        const passportId =
          clean(
            reference
              ?.passportId
          );

        if (
          passportId
        ) {
          passportIds.add(
            passportId
          );
        }
      }
    );
  }


  collect(
    source.references
  );


  safeArray(
    source.lines
  ).forEach(
    line =>
      collect(
        line
          ?.references
      )
  );


  return Array.from(
    passportIds
  );
}


/* =========================================================
   DOCUMENT WRITE SCOPE
   ========================================================= */

function authorizeFinancialDocumentWrite({
  accessContext = {},
  action = "",
  financialDocument = {},
  writeScope = "passport"
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );


  const base =
    authorizeFinancialAction({
      accessContext:
        context,

      action
    });


  if (
    !base.allowed
  ) {
    return base;
  }


  if (
    isFinancialAdmin(
      context
    )
  ) {
    return {
      ...base,

      documentPassportIds:
        getFinancialDocumentPassportIds(
          financialDocument
        )
    };
  }


  const documentPassportIds =
    getFinancialDocumentPassportIds(
      financialDocument
    );


  const resolvedWriteScope =
    clean(
      writeScope ||
      "passport"
    ).toLowerCase();


  /*
   * CARD TRAN$ACT
   * -------------
   *
   * Passport scope is mandatory.
   *
   * A card cannot create Financial truth unless
   * the transaction is attributable to at least
   * one authorized Passport.
   *
   *
   * DESKTOP TRAN$ACT
   * ----------------
   *
   * Entity scope may intentionally contain zero
   * object Passport references.
   *
   * Examples:
   *
   * - manual journal
   * - bank fee
   * - depreciation
   * - opening balance
   * - tax adjustment
   * - rounding adjustment
   * - suspense / other
   *
   * Entity ownership itself comes from trusted
   * authenticated access context and is persisted
   * server-side. Browser-supplied Entity identity
   * is never trusted.
   */

  if (
    documentPassportIds.length ===
      0
  ) {

    if (
      resolvedWriteScope ===
        "entity" &&
      clean(
        context.entityPassportId
      )
    ) {
      return {
        ...base,

        allowed:
          true,

        reason:
          "entity-scoped-write",

        action:
          clean(
            action
          ),

        actorPassportId:
          context.actorPassportId,

        entityPassportId:
          context.entityPassportId,

        writeScope:
          "entity",

        documentPassportIds:
          []
      };
    }


    return {
      allowed:
        false,

      reason:
        "document-has-no-passport-scope",

      action:
        clean(
          action
        ),

      actorPassportId:
        context.actorPassportId,

      entityPassportId:
        context.entityPassportId,

      writeScope:
        resolvedWriteScope,

      documentPassportIds
    };
  }


  const inaccessible =
    documentPassportIds.filter(
      passportId =>
        !canAccessFinancialPassport({
          accessContext:
            context,

          passportId
        })
    );


  if (
    inaccessible.length
  ) {
    return {
      allowed:
        false,

      reason:
        "document-passport-scope-denied",

      action:
        clean(
          action
        ),

      actorPassportId:
        context.actorPassportId,

      documentPassportIds,

      inaccessiblePassportIds:
        inaccessible
    };
  }


  return {
    allowed:
      true,

    reason:
      "allowed",

    action:
      clean(
        action
      ),

    actorPassportId:
      context.actorPassportId,

    documentPassportIds
  };
}


/* =========================================================
   ASSERT DOCUMENT WRITE
   ========================================================= */

function assertFinancialDocumentWrite({
  accessContext = {},
  action = "",
  financialDocument = {}
} = {}) {
  const result =
    authorizeFinancialDocumentWrite({
      accessContext,
      action,
      financialDocument
    });

  if (
    !result.allowed
  ) {
    const error =
      new Error(
        `Financial document authorization denied: ${result.reason}`
      );

    error.name =
      "IXIFinancialAuthorizationError";

    error.details =
      result;

    throw error;
  }

  return result;
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  IXI_FINANCIAL_ACTIONS,
  IXI_FINANCIAL_ROLES,

  ROLE_PERMISSIONS,

  normalizeFinancialAccessContext,

  getRolePermissions,
  getEffectiveFinancialPermissions,

  isFinancialAdmin,

  canAccessFinancialPassport,
  hasFinancialPermission,

  authorizeFinancialAction,
  assertFinancialPermission,

  getFinancialDocumentPassportIds,

  authorizeFinancialDocumentWrite,
  assertFinancialDocumentWrite
};
