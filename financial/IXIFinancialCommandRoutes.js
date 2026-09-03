"use strict";

/*
 * IXI FINANCIAL COMMAND ROUTES
 *
 * PURPOSE
 * -------
 *
 * Secure HTTP boundary for Financial
 * Commands.
 *
 *
 * PRIMARY ENDPOINT
 * ----------------
 *
 * POST /financial/commands/create
 *
 *
 * FLOW
 * ----
 *
 * HTTP
 *   ↓
 * trusted Access Context
 *   ↓
 * Factory preview
 *   ↓
 * Financial Permission Engine
 *   ↓
 * Financial Command Engine
 *   ↓
 * Registry
 *   ↓
 * Provider Service
 *   ↓
 * DynamoDB
 *   ↓
 * refreshed AOF2 snapshot
 *
 *
 * SECURITY RULE
 * -------------
 *
 * Client-supplied:
 *
 * actorPassportId
 * entityPassportId
 * roles
 * permissions
 * managedPassportIds
 *
 * are NOT trusted.
 */


const express =
  require("express");


const {
  resolveFinancialAccessContextFromRequest
} =
  require(
    "./IXIFinancialAccessContextBridge"
  );


const {
  IXI_FINANCIAL_ACTIONS,

  authorizeFinancialAction,
  authorizeFinancialDocumentWrite
} =
  require(
    "./IXIFinancialPermissionEngine"
  );


const {
  createFinancialDocumentByType
} =
  require(
    "./IXIFinancialDocumentFactoryRegistry"
  );


const {
  executeCreateFinancialDocumentCommand,
  executePostJournalEntryCommand,
  executeCloseFinancialPeriodCommand
} =
  require(
    "./IXIFinancialCommandEngine"
  );


const router =
  express.Router();


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

function getCreateFinancialAction(documentType="",input={}) {
  const type=clean(documentType).toLowerCase();
  if(type==="payment"&&clean(input?.treasuryMovement?.transactionClass)) return IXI_FINANCIAL_ACTIONS.POST_TREASURY_MOVEMENT;
  if(type==="payment") return IXI_FINANCIAL_ACTIONS.RECORD_PAYMENT;
  if(type==="credit") return IXI_FINANCIAL_ACTIONS.APPLY_VENDOR_CREDIT;
  if(type==="payables-control") return IXI_FINANCIAL_ACTIONS.MANAGE_PAYABLES;
  if(type==="treasury-account") return IXI_FINANCIAL_ACTIONS.MANAGE_TREASURY;
  if(type==="treasury-reconciliation") return IXI_FINANCIAL_ACTIONS.RECONCILE_TREASURY;
  if(type==="journal-entry") return IXI_FINANCIAL_ACTIONS.CREATE_JOURNAL;
  return IXI_FINANCIAL_ACTIONS.CREATE_DOCUMENT;
}

function bindTrustedCommandInput({documentType="",input={},accessContext={}}={}) {
  const type=clean(documentType).toLowerCase(),source={...safeObject(input)};
  if(type==="payment") {
    const treasury=clean(source?.treasuryMovement?.transactionClass);
    return {...source,payerPassportId:clean(accessContext.entityPassportId),employeePassportId:clean(accessContext.actorPassportId),...(treasury?{references:[...(Array.isArray(source.references)?source.references:[]),{passportId:clean(accessContext.entityPassportId),role:"entity"},{passportId:clean(accessContext.actorPassportId),role:"recorded-by"}],treasuryMovement:{...safeObject(source.treasuryMovement),entityPassportId:clean(accessContext.entityPassportId),actorPassportId:clean(accessContext.actorPassportId)}}:{})};
  }
  if(type==="credit") return {...source,recordedByPassportId:clean(accessContext.actorPassportId)};
  if(type==="payables-control") return {...source,entityPassportId:clean(accessContext.entityPassportId),actorPassportId:clean(accessContext.actorPassportId)};
  if(["treasury-account","treasury-reconciliation"].includes(type)) return {...source,entityPassportId:clean(accessContext.entityPassportId),actorPassportId:clean(accessContext.actorPassportId)};
  return source;
}


/* =========================================================
   AUTH FAILURE
   ========================================================= */

function createAuthorizationFailure({
  accessContext = {},
  reason = "permission-denied",
  action = ""
} = {}) {

  const authenticated =
    Boolean(
      accessContext
        ?.authenticated
    );


  return {
    ok:
      false,

    contract:
      "ixi-financial",

    contractVersion:
      "1.0.0",

    operation:
      "financial.command.create",

    requestId:
      "",

    data:
      null,

    errors: [
      {
        name:
          authenticated
            ? "IXIFinancialAuthorizationError"
            : "IXIFinancialAuthenticationError",

        message:
          authenticated
            ? "Financial permission denied."
            : "Financial authentication required.",

        details: {
          reason,

          action,

          actorPassportId:
            clean(
              accessContext
                ?.actorPassportId
            )
        }
      }
    ],

    warnings:
      [],

    metadata:
      {}
  };
}


/* =========================================================
   ERROR RESPONSE
   ========================================================= */

function createCommandRouteError(
  error
) {

  return {
    ok:
      false,

    contract:
      "ixi-financial",

    contractVersion:
      "1.0.0",

    operation:
      "financial.command.create",

    requestId:
      "",

    data:
      null,

    errors: [
      {
        name:
          clean(
            error?.name ||
            "IXIFinancialCommandRouteError"
          ),

        message:
          clean(
            error?.message ||
            "Financial command failed."
          ),

        details:
          safeObject(
            error?.details
          )
      }
    ],

    warnings:
      [],

    metadata:
      {}
  };
}


/* =========================================================
   STATUS
   ========================================================= */

function getStatus(
  result
) {

  if (
    result?.ok
  ) {

    if (
      result.created ===
        true
    ) {
      return 201;
    }

    return 200;
  }


  const error =
    Array.isArray(
      result?.errors
    )
      ? result.errors[0]
      : null;


  const name =
    clean(
      error?.name
    );


  if (
    name ===
      "IXIFinancialAuthenticationError"
  ) {
    return 401;
  }


  if (
    name ===
      "IXIFinancialAuthorizationError"
  ) {
    return 403;
  }


  if (
    name ===
      "IXIFinancialDocumentNotFoundError"
  ) {
    return 404;
  }


  if (
    name ===
      "IXIFinancialConflictError" ||
    name ===
      "IXIFinancialRevisionConflictError" ||
    name ===
      "IXIFinancialJournalStateConflictError"
  ) {
    return 409;
  }


  if (
    name ===
      "IXIFinancialUnsupportedDocumentTypeError" ||
    name ===
      "IXIFinancialValidationError" ||
    name ===
      "IXIFinancialCommandError"
  ) {
    return 400;
  }


  return 400;
}


/* =========================================================
   CREATE COMMAND
   ========================================================= */

/* =========================================================
   TRAN$ACT DESKTOP — POST JOURNAL ENTRY
   ========================================================= */

router.post(
  "/desktop/journals/:financialDocumentId/post",
  async (
    req,
    res
  ) => {
    try {
      const body =
        safeObject(
          req.body
        );

      const accessContext =
        await resolveFinancialAccessContextFromRequest(
          req
        );

      const authorization =
        authorizeFinancialAction({
          accessContext,

          action:
            IXI_FINANCIAL_ACTIONS
              .POST_JOURNAL
        });

      if (
        !authorization.allowed
      ) {
        const response =
          createAuthorizationFailure({
            accessContext,
            reason:
              authorization.reason,
            action:
              IXI_FINANCIAL_ACTIONS
                .POST_JOURNAL
          });

        return res
          .status(
            getStatus(
              response
            )
          )
          .json(
            response
          );
      }

      const result =
        await executePostJournalEntryCommand({
          financialDocumentId:
            clean(
              req.params
                .financialDocumentId
            ),

          expectedRevision:
            body.expectedRevision,

          actorPassportId:
            accessContext
              .actorPassportId,

          entityPassportId:
            accessContext
              .entityPassportId,

          commandId:
            clean(
              body.commandId
            ),

          idempotencyKey:
            clean(
              body.idempotencyKey
            ),

          requestId:
            clean(
              req.headers[
                "x-request-id"
              ]
            ),

          source:
            "ixi-transact-desktop",

          metadata: {
            ...safeObject(
              body.metadata
            ),

            transactSurface:
              "desktop",

            accountingScope:
              "entity"
          }
        });

      return res
        .status(
          getStatus(
            result
          )
        )
        .json(
          result
        );

    } catch (
      error
    ) {
      console.error(
        "TRAN$ACT journal-post command failed:",
        error
      );

      const response =
        createCommandRouteError(
          error
        );

      return res
        .status(500)
        .json(
          response
        );
    }
  }
);

/*
 * =========================================================
 * TRAN$ACT DESKTOP CREATE
 * =========================================================
 *
 * Explicit Entity-scoped Financial command path.
 *
 * Card TRAN$ACT continues using /create and therefore
 * continues requiring Passport scope.
 *
 * Desktop TRAN$ACT may create a valid Financial Document
 * with zero object Passport references because the
 * authenticated Entity owns the accounting transaction.
 *
 * The browser cannot choose writeScope.
 */

/*
 * =========================================================
 * TRAN$ACT DESKTOP — CLOSE ACCOUNTING PERIOD
 * =========================================================
 *
 * This is an accounting CONTROL command.
 *
 * Browser may request:
 * - period
 * - currency
 * - commandId
 * - idempotencyKey
 *
 * Browser may NOT choose:
 * - actor
 * - entity
 * - trial balance
 * - close checks
 * - closedBy
 * - close evidence
 *
 * Those are server-derived.
 */

router.post(
  "/desktop/close-period",
  async (
    req,
    res
  ) => {

    try {

      const body =
        safeObject(
          req.body
        );


      const accessContext =
        await resolveFinancialAccessContextFromRequest(
          req
        );


      /*
       * Close currently requires the canonical
       * Financial document-create authority.
       *
       * The command itself is additionally isolated
       * behind this dedicated server route and cannot
       * be created through generic /desktop/create.
       */
      const authorization =
        authorizeFinancialAction({
          accessContext,

          action:
            IXI_FINANCIAL_ACTIONS
              .CLOSE_PERIOD
        });


      if (
        !authorization.allowed
      ) {

        const response =
          createAuthorizationFailure({
            accessContext,

            reason:
              authorization.reason,

            action:
              IXI_FINANCIAL_ACTIONS
                .CLOSE_PERIOD
          });


        return res
          .status(
            getStatus(
              response
            )
          )
          .json(
            response
          );
      }


      const result =
        await executeCloseFinancialPeriodCommand({
          actorPassportId:
            accessContext
              .actorPassportId,

          entityPassportId:
            accessContext
              .entityPassportId,

          period:
            clean(
              body.period
            ),

          currency:
            clean(
              body.currency ||
              "USD"
            ).toUpperCase(),

          commandId:
            clean(
              body.commandId
            ),

          idempotencyKey:
            clean(
              body.idempotencyKey
            ),

          requestId:
            clean(
              req.headers[
                "x-request-id"
              ]
            ),

          metadata: {
            ...safeObject(
              body.metadata
            ),

            transactSurface:
              "desktop",

            accountingScope:
              "entity",

            periodControl:
              "close"
          }
        });


      return res
        .status(
          getStatus(
            result
          )
        )
        .json(
          result
        );


    } catch (
      error
    ) {

      console.error(
        "TRAN$ACT period-close command failed:",
        error
      );


      const response =
        createCommandRouteError(
          error
        );


      return res
        .status(500)
        .json(
          response
        );
    }
  }
);


router.post(
  "/desktop/create",
  async (
    req,
    res
  ) => {

    try {

      const body =
        safeObject(
          req.body
        );


      const accessContext =
        await resolveFinancialAccessContextFromRequest(
          req
        );


      const documentType =
        clean(
          body.documentType
        ).toLowerCase();


      const commandInput = bindTrustedCommandInput({documentType,input:body.input,accessContext});

      const requiredAction=getCreateFinancialAction(documentType,commandInput);


      let previewDocument;


      try {

        previewDocument =
          createFinancialDocumentByType({
            documentType,

            input:
              commandInput
          });

      } catch (
        error
      ) {

        const response =
          createCommandRouteError(
            error
          );


        return res
          .status(
            getStatus(
              response
            )
          )
          .json(
            response
          );
      }


      /*
       * Important:
       *
       * Entity writeScope comes from THIS SERVER ROUTE.
       * It is not accepted from req.body.
       */
      const authorization =
        authorizeFinancialDocumentWrite({
          accessContext,

          action: requiredAction,

          financialDocument:
            previewDocument,

          writeScope:
            "entity"
        });


      if (
        !authorization.allowed
      ) {

        const response =
          createAuthorizationFailure({
            accessContext,

            reason:
              authorization.reason,

            action: requiredAction
          });


        return res
          .status(
            getStatus(
              response
            )
          )
          .json(
            response
          );
      }


      /*
       * Trusted ownership only.
       *
       * actorPassportId + entityPassportId
       * are never accepted from request body.
       */
      const result =
        await executeCreateFinancialDocumentCommand({
          documentType,

          input:
            commandInput,

          actorPassportId:
            accessContext
              .actorPassportId,

          entityPassportId:
            accessContext
              .entityPassportId,

          commandId:
            clean(
              body.commandId
            ),

          idempotencyKey:
            clean(
              body.idempotencyKey
            ),

          requestId:
            clean(
              req.headers[
                "x-request-id"
              ]
            ),

          source:
            "ixi-transact-desktop",

          metadata: {
            ...safeObject(
              body.metadata
            ),

            transactSurface:
              "desktop",

            accountingScope:
              "entity"
          },

          snapshot:
            safeObject(
              body.snapshot
            )
        });


      return res
        .status(
          getStatus(
            result
          )
        )
        .json(
          result
        );


    } catch (
      error
    ) {

      console.error(
        "TRAN$ACT Desktop financial command failed:",
        error
      );


      const response =
        createCommandRouteError(
          error
        );


      return res
        .status(500)
        .json(
          response
        );
    }
  }
);


router.post(
  "/create",
  async (
    req,
    res
  ) => {

    try {

      const body =
        safeObject(
          req.body
        );


      /*
       * Resolve trusted actor/entity context.
       */
      const accessContext =
        await resolveFinancialAccessContextFromRequest(
          req
        );


      const documentType =
        clean(
          body.documentType
        ).toLowerCase();


      const commandInput = bindTrustedCommandInput({documentType,input:body.input,accessContext});

      const requiredAction=getCreateFinancialAction(documentType);


      /*
       * Build a preview of the exact TYPE and
       * Passport references this command will
       * create.
       *
       * This is NOT persisted.
       */
      let previewDocument;


      try {

        previewDocument =
          createFinancialDocumentByType({
            documentType,

            input:
              commandInput
          });

      } catch (
        error
      ) {

        const response =
          createCommandRouteError(
            error
          );


        return res
          .status(
            getStatus(
              response
            )
          )
          .json(
            response
          );
      }


      /*
       * Authorize the write against the
       * resulting financial Passport scope.
       */
      const authorization =
        authorizeFinancialDocumentWrite({
          accessContext,

          action: requiredAction,

          financialDocument:
            previewDocument
        });


      if (
        !authorization.allowed
      ) {

        const response =
          createAuthorizationFailure({
            accessContext,

            reason:
              authorization.reason,

            action: requiredAction
          });


        return res
          .status(
            getStatus(
              response
            )
          )
          .json(
            response
          );
      }


      /*
       * IMPORTANT:
       *
       * actorPassportId and entityPassportId
       * come ONLY from trusted accessContext.
       *
       * Any values supplied in req.body are
       * intentionally ignored.
       */
      const result =
        await executeCreateFinancialDocumentCommand({
          documentType,

          input:
            commandInput,

          actorPassportId:
            accessContext
              .actorPassportId,

          entityPassportId:
            accessContext
              .entityPassportId,

          commandId:
            clean(
              body.commandId
            ),

          idempotencyKey:
            clean(
              body.idempotencyKey
            ),

          requestId:
            clean(
              req.headers[
                "x-request-id"
              ]
            ),

          source:
            clean(
              req.headers[
                "x-ixi-source"
              ] ||
              "ixi-financial-http-command"
            ),

          metadata:
            safeObject(
              body.metadata
            ),

          snapshot:
            safeObject(
              body.snapshot
            )
        });


      return res
        .status(
          getStatus(
            result
          )
        )
        .json(
          result
        );

    } catch (
      error
    ) {

      console.error(
        "Financial command route failed:",
        error
      );


      const response =
        createCommandRouteError(
          error
        );


      return res
        .status(
          500
        )
        .json(
          response
        );
    }
  }
);


/* =========================================================
   EXPORT
   ========================================================= */

module.exports =
  router;
