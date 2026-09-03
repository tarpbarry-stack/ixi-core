"use strict";

/*
 * IXI FINANCIAL HTTP ROUTES
 *
 * PRODUCTION FLOW
 * ---------------
 *
 * HTTP
 *   ↓
 * Access Context Bridge
 *   ↓
 * Authorized Provider Service
 *   ↓
 * Storage Provider
 *   ↓
 * DynamoDB / local-json
 *
 *
 * Provider is selected by:
 *
 * IXI_FINANCIAL_STORAGE_PROVIDER
 */


const express =
  require("express");


const providerService =
  require(
    "./IXIFinancialProviderService"
  );


const {
  resolveFinancialAccessContextFromRequest
} =
  require(
    "./IXIFinancialAccessContextBridge"
  );


const {
  IXI_FINANCIAL_ACTIONS,

  normalizeFinancialAccessContext,

  authorizeFinancialAction,

  authorizeFinancialDocumentWrite,

  canAccessFinancialPassport,

  getFinancialDocumentPassportIds
} =
  require(
    "./IXIFinancialPermissionEngine"
  );


const {
  getFinancialStorageProvider
} =
  require(
    "./IXIFinancialStorageProvider"
  );


const financialStore =
  require(
    "./IXIFinancialDynamoStore"
  );


const financialCommandRoutes =
  require(
    "./IXIFinancialCommandRoutes"
  );

const authorizedFinancialService =
  require(
    "./IXIFinancialAuthorizedService"
  );

const {
  createFinancialDashboardProjection
} =
  require(
    "./IXIFinancialDashboardProjectionEngine"
  );


const {
  discoverFinancialPassportScope
} =
  require(
    "./IXIFinancialScopeDiscoveryService"
  );



const {
  getFinancialGLProjection
} =
  require(
    "./IXIFinancialGLService"
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
    typeof value ===
      "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function getBillPatchAction(existing = {}, merged = {}) {
  const type = clean(merged.documentType).toLowerCase();
  if (type === "payables-control") return IXI_FINANCIAL_ACTIONS.MANAGE_PAYABLES;
  if (type === "collection") return IXI_FINANCIAL_ACTIONS.MANAGE_COLLECTIONS;
  if (type === "settlement") {
    const beforeStatus = clean(existing?.assetSettlement?.status).toLowerCase();
    const afterStatus = clean(merged?.assetSettlement?.status).toLowerCase();
    return afterStatus === "approved" && beforeStatus !== "approved"
      ? IXI_FINANCIAL_ACTIONS.APPROVE_SETTLEMENT
      : IXI_FINANCIAL_ACTIONS.PREPARE_SETTLEMENT;
  }
  if (type === "purchase-order") {
    const before = safeObject(existing.purchaseOrderRecord);
    const after = safeObject(merged.purchaseOrderRecord);
    const beforeApproval = clean(before?.approval?.status).toLowerCase();
    const afterApproval = clean(after?.approval?.status).toLowerCase();
    const beforeStatus = clean(before?.status).toLowerCase();
    const afterStatus = clean(after?.status).toLowerCase();
    if (afterApproval === "approved" && beforeApproval !== "approved") return IXI_FINANCIAL_ACTIONS.APPROVE_DOCUMENT;
    if (["returned", "denied", "rejected"].includes(afterApproval) && beforeApproval !== afterApproval) return IXI_FINANCIAL_ACTIONS.REJECT_DOCUMENT;
    if (["cancelled", "void"].includes(afterStatus) && beforeStatus !== afterStatus) return IXI_FINANCIAL_ACTIONS.VOID_DOCUMENT;
    return IXI_FINANCIAL_ACTIONS.PATCH_DOCUMENT;
  }
  if (!["bill", "supplier-invoice"].includes(type)) return IXI_FINANCIAL_ACTIONS.PATCH_DOCUMENT;
  const before = safeObject(existing.billRecord);
  const after = safeObject(merged.billRecord);
  const beforeApproval = clean(before?.approval?.status).toLowerCase();
  const afterApproval = clean(after?.approval?.status).toLowerCase();
  const beforeState = clean(existing.financialState).toLowerCase();
  const afterState = clean(merged.financialState).toLowerCase();
  if (afterApproval === "approved" && beforeApproval !== "approved") return IXI_FINANCIAL_ACTIONS.APPROVE_DOCUMENT;
  if (["rejected", "returned"].includes(afterApproval) && beforeApproval !== afterApproval) return IXI_FINANCIAL_ACTIONS.REJECT_DOCUMENT;
  if (afterState === "void" && beforeState !== "void") return IXI_FINANCIAL_ACTIONS.VOID_DOCUMENT;
  if (["partially-paid", "paid"].includes(afterState) && beforeState !== afterState) return IXI_FINANCIAL_ACTIONS.RECORD_PAYMENT;
  if (clean(after?.purchaseMatch?.status).toLowerCase() === "matched" && clean(before?.purchaseMatch?.status).toLowerCase() === "exception") return IXI_FINANCIAL_ACTIONS.APPROVE_DOCUMENT;
  return IXI_FINANCIAL_ACTIONS.PATCH_DOCUMENT;
}

function bindPurchaseOrderActorEvidence(patch = {}, action = "", accessContext = {}) {
  const source = safeObject(patch);
  const record = safeObject(source.purchaseOrderRecord);
  if (!Object.keys(record).length) return source;
  const actorPassportId = clean(accessContext.actorPassportId);
  const entityPassportId = clean(accessContext.entityPassportId);
  const timestamp = new Date().toISOString();
  const approval = { ...safeObject(record.approval) };
  const receiving = { ...safeObject(record.receiving) };
  if (action === IXI_FINANCIAL_ACTIONS.APPROVE_DOCUMENT) {
    approval.approvedById = actorPassportId;
    approval.approvedAt = timestamp;
  }
  if (action === IXI_FINANCIAL_ACTIONS.REJECT_DOCUMENT) {
    approval.decidedById = actorPassportId;
    approval.decidedAt = timestamp;
  }
  if (receiving.lastReceivedAt) receiving.lastReceivedById = actorPassportId;
  return {
    ...source,
    purchaseOrderRecord: {
      ...record,
      context: {
        ...safeObject(record.context),
        entityPassportId,
        employeePassportId: actorPassportId
      },
      approval,
      receiving,
      audit: {
        ...safeObject(record.audit),
        updatedAt: timestamp,
        updatedBy: actorPassportId
      }
    }
  };
}

async function bindOperationalControlEvidence({ patch = {}, merged = {}, existing = {}, action = "", accessContext = {} } = {}) {
  const source = safeObject(patch);
  const type = clean(merged.documentType).toLowerCase();
  const actorPassportId = clean(accessContext.actorPassportId);
  const entityPassportId = clean(accessContext.entityPassportId);
  const timestamp = new Date().toISOString();

  if (type === "collection") {
    const record = { ...safeObject(merged.collectionCase) };
    return {
      ...source,
      collectionCase: {
        ...record,
        context: { ...safeObject(record.context), entityPassportId },
        audit: { ...safeObject(record.audit), updatedAt: timestamp, updatedBy: actorPassportId }
      }
    };
  }

  if (type === "settlement") {
    const record = { ...safeObject(merged.assetSettlement) };
    const approving = action === IXI_FINANCIAL_ACTIONS.APPROVE_SETTLEMENT;
    const prior = safeObject(existing.assetSettlement);
    if (approving && clean(prior.status).toLowerCase() !== "ready") throw Object.assign(new Error("Settlement approval requires a ready canonical Settlement."), { name: "IXIFinancialSettlementTransitionError" });
    let status = approving ? "approved" : clean(prior.status || record.status).toLowerCase();
    let paymentStatus = approving ? "unpaid" : clean(prior.paymentStatus || record.paymentStatus || "unpaid").toLowerCase();
    let waterfall = safeObject(record.waterfall);
    let ownerPayments = Array.isArray(prior.ownerPayments) ? prior.ownerPayments : [];
    if (!approving && ["approved", "partially-paid", "settled"].includes(clean(prior.status).toLowerCase())) {
      const listed = await providerService.listDocumentsByPassport({ passportId: entityPassportId });
      if (!listed?.ok) throw Object.assign(new Error("Settlement payment state could not be verified."), { name: "IXIFinancialSettlementReadError" });
      const settlementId = clean(existing.financialDocumentId);
      const payments = (Array.isArray(listed?.data?.documents) ? listed.data.documents : []).map(item => {
        const envelope = safeObject(item?.record || item), document = safeObject(envelope.financialDocument || envelope);
        return { ...document, metadata: { ...safeObject(envelope.metadata), ...safeObject(document.metadata) } };
      }).filter(document => clean(document.documentType).toLowerCase() === "payment" && clean(document.paymentDirection).toLowerCase() === "outflow" && clean(document.sourceFinancialDocumentId) === settlementId && !["void", "reversed"].includes(clean(document.financialState).toLowerCase()));
      const paidByOwner = new Map();
      payments.forEach(document => { const ownerId = clean(document?.metadata?.ownerId); if (ownerId) paidByOwner.set(ownerId, (paidByOwner.get(ownerId) || 0) + Math.abs(Number(document?.totals?.total || document?.totals?.subtotal || 0))); });
      const owners = (Array.isArray(waterfall.owners) ? waterfall.owners : []).map(owner => { const ownerId = clean(owner?.ownerId), paid = Math.round((paidByOwner.get(ownerId) || 0) * 100) / 100, finalDue = Number(owner?.finalDue || 0); return { ...owner, paid, balanceDue: Math.round(Math.max(0, finalDue - paid) * 100) / 100 }; });
      const totalPaid = owners.reduce((sum, owner) => sum + Number(owner.paid || 0), 0), totalBalance = owners.reduce((sum, owner) => sum + Number(owner.balanceDue || 0), 0);
      status = totalBalance <= 0.005 ? "settled" : totalPaid > 0 ? "partially-paid" : "approved";
      paymentStatus = status === "settled" ? "paid" : status === "partially-paid" ? "partial" : "unpaid";
      waterfall = { ...waterfall, owners };
      ownerPayments = payments.map(document => ({ paymentId: clean(document.financialDocumentId), ownerId: clean(document?.metadata?.ownerId), amount: Math.abs(Number(document?.totals?.total || document?.totals?.subtotal || 0)), date: clean(document.occurredAt), method: clean(document.paymentMethod), reference: clean(document.transactionReference) }));
    }
    return {
      ...source,
      status,
      financialState: status === "settled" ? "paid" : "submitted",
      assetSettlement: {
        ...record,
        status,
        paymentStatus,
        waterfall,
        ownerPayments,
        context: { ...safeObject(record.context), entityPassportId },
        controls: approving ? {
          ...safeObject(record.controls),
          approvedById: actorPassportId,
          approvedAt: timestamp,
          permissionEvidence: {
            action: IXI_FINANCIAL_ACTIONS.APPROVE_SETTLEMENT,
            actorPassportId,
            entityPassportId,
            allowed: true,
            recordedAt: timestamp
          }
        } : safeObject(prior.controls || record.controls),
        audit: { ...safeObject(record.audit), updatedAt: timestamp, updatedBy: actorPassportId }
      }
    };
  }

  return source;
}


function bindBillActorEvidence(patch = {}, action = "", actorPassportId = "") {
  const source = safeObject(patch);
  if (!["bill", "supplier-invoice"].includes(clean(source.documentType).toLowerCase()) && !source.billRecord) return source;
  const record = safeObject(source.billRecord);
  if (!Object.keys(record).length) return source;
  const approval = { ...safeObject(record.approval) };
  const purchaseMatch = { ...safeObject(record.purchaseMatch) };
  if (action === IXI_FINANCIAL_ACTIONS.APPROVE_DOCUMENT && clean(approval.status).toLowerCase() === "approved") approval.approvedById = clean(actorPassportId);
  if (action === IXI_FINANCIAL_ACTIONS.REJECT_DOCUMENT && clean(approval.status).toLowerCase() === "rejected") approval.rejectedById = clean(actorPassportId);
  if (action === IXI_FINANCIAL_ACTIONS.REJECT_DOCUMENT && clean(approval.status).toLowerCase() === "returned") approval.returnedById = clean(actorPassportId);
  if (action === IXI_FINANCIAL_ACTIONS.APPROVE_DOCUMENT && purchaseMatch.varianceApproval) purchaseMatch.varianceApproval = { ...safeObject(purchaseMatch.varianceApproval), approvedById: clean(actorPassportId) };
  return { ...source, billRecord: { ...record, approval, purchaseMatch } };
}


function firstError(
  envelope
) {
  return Array.isArray(
    envelope?.errors
  )
    ? envelope.errors[0] ||
      null
    : null;
}


/* =========================================================
   REQUEST CONTEXT
   ========================================================= */

function getRequestContext(
  req
) {
  const forwardedFor =
    clean(
      req.headers[
        "x-forwarded-for"
      ]
    );


  return {
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
        "ixi-http"
      ),

    sourceIp:
      forwardedFor
        ? forwardedFor
            .split(",")[0]
            .trim()
        : clean(
            req.ip ||
            req.socket
              ?.remoteAddress
          ),

    userAgent:
      clean(
        req.headers[
          "user-agent"
        ]
      )
  };
}


/* =========================================================
   STATUS
   ========================================================= */

function getEnvelopeStatus(
  envelope,
  {
    successStatus = 200
  } = {}
) {
  if (
    envelope?.ok
  ) {
    return successStatus;
  }


  const error =
    firstError(
      envelope
    );


  const name =
    clean(
      error?.name
    );


  const message =
    clean(
      error?.message ||
      error
    ).toLowerCase();


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
      "IXIFinancialNotFoundError" ||
    message.includes(
      "not found"
    )
  ) {
    return 404;
  }


  if (
    name ===
      "IXIFinancialConflictError" ||
    name ===
      "IXIFinancialRevisionConflictError" ||
    message.includes(
      "already exists"
    ) ||
    message.includes(
      "revision"
    )
  ) {
    return 409;
  }


  if (
    name ===
      "IXIFinancialValidationError" ||
    envelope
      ?.data
      ?.validation ||
    message.includes(
      "required"
    ) ||
    message.includes(
      "invalid"
    )
  ) {
    return 400;
  }


  return 500;
}


function sendEnvelope(
  res,
  envelope,
  options = {}
) {
  return res
    .status(
      getEnvelopeStatus(
        envelope,
        options
      )
    )
    .json(
      envelope
    );
}


/* =========================================================
   ACCESS
   ========================================================= */

async function getAccess(
  req
) {
  return resolveFinancialAccessContextFromRequest(
    req
  );
}


/* =========================================================
   AUTH FAILURE
   ========================================================= */

function createAuthorizationFailure({
  accessContext = {},
  operation = "",
  action = "",
  reason = "permission-denied",
  details = {}
} = {}) {
  const context =
    normalizeFinancialAccessContext(
      accessContext
    );


  return {
    ok:
      false,

    contract:
      "ixi-financial",

    contractVersion:
      "1.0.0",

    operation,

    requestId:
      "",

    data:
      null,

    errors: [
      {
        name:
          !context.authenticated
            ? "IXIFinancialAuthenticationError"
            : "IXIFinancialAuthorizationError",

        message:
          !context.authenticated
            ? "Financial authentication required."
            : "Financial permission denied.",

        details: {
          reason,

          action,

          actorPassportId:
            context.actorPassportId,

          ...safeObject(
            details
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
   DOCUMENT READ AUTH
   ========================================================= */

async function authorizeDocumentRead({
  accessContext,
  financialDocumentId,
  action,
  operation
}) {
  const base =
    authorizeFinancialAction({
      accessContext,
      action
    });


  if (
    !base.allowed
  ) {
    return createAuthorizationFailure({
      accessContext,

      operation,

      action,

      reason:
        base.reason
    });
  }


  const provider =
    getFinancialStorageProvider();


  const record =
    await provider
      .getFinancialDocumentRecord(
        financialDocumentId
      );


  if (
    !record
  ) {
    return null;
  }


  const passportIds =
    getFinancialDocumentPassportIds(
      record.financialDocument
    );


  const entityMatch =
    clean(
      record
        ?.server
        ?.entityPassportId
    ) &&
    clean(
      record
        ?.server
        ?.entityPassportId
    ) ===
      clean(
        accessContext
          ?.entityPassportId
      );


  const passportMatch =
    passportIds.some(
      passportId =>
        canAccessFinancialPassport({
          accessContext,
          passportId
        })
    );


  const isAdmin =
    normalizeFinancialAccessContext(
      accessContext
    )
      .roles
      .includes(
        "financial-admin"
      );


  if (
    isAdmin ||
    entityMatch ||
    passportMatch
  ) {
    return null;
  }


  return createAuthorizationFailure({
    accessContext,

    operation,

    action,

    reason:
      "document-scope-denied",

    details: {
      financialDocumentId,

      documentPassportIds:
        passportIds
    }
  });
}


/* =========================================================
   HEALTH
   ========================================================= */

router.get(
  "/health",
  async (
    req,
    res
  ) => {

    return sendEnvelope(
      res,
      await providerService
        .getHealth()
    );
  }
);


/* =========================================================
   CREATE
   ========================================================= */

router.post(
  "/documents",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const context =
      getRequestContext(
        req
      );


    const financialDocument =
      req.body
        ?.financialDocument ||
      req.body
        ?.document;

    const directType=clean(financialDocument?.documentType).toLowerCase(),treasuryMovement=clean(financialDocument?.treasuryMovement?.transactionClass);
    if(["treasury-account","treasury-reconciliation"].includes(directType)||(directType==="payment"&&treasuryMovement)) return res.status(409).json({ok:false,error:{name:"IXITreasuryCommandRequiredError",message:"Treasury records may only be written through the controlled financial command endpoint."}});


    const authorization =
      authorizeFinancialDocumentWrite({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .CREATE_DOCUMENT,

        financialDocument
      });


    if (
      !authorization.allowed
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.document.create",

          action:
            IXI_FINANCIAL_ACTIONS
              .CREATE_DOCUMENT,

          reason:
            authorization.reason,

          details:
            authorization
        })
      );
    }


    const envelope =
      await providerService
        .createDocument({
          ...safeObject(
            req.body
          ),

          ...context,

          actorPassportId:
            accessContext
              .actorPassportId,

          entityPassportId:
            accessContext
              .entityPassportId
        });


    return sendEnvelope(
      res,
      envelope,
      {
        successStatus:
          envelope
            ?.data
            ?.created
              ? 201
              : 200
      }
    );
  }
);


/* =========================================================
   GET DOCUMENT
   ========================================================= */

router.get(
  "/documents/:financialDocumentId",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const failure =
      await authorizeDocumentRead({
        accessContext,

        financialDocumentId:
          req.params
            .financialDocumentId,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_DOCUMENT,

        operation:
          "financial.document.get"
      });


    if (
      failure
    ) {
      return sendEnvelope(
        res,
        failure
      );
    }


    return sendEnvelope(
      res,
      await providerService
        .getDocument({
          financialDocumentId:
            req.params
              .financialDocumentId
        })
    );
  }
);


/* =========================================================
   PATCH
   ========================================================= */

router.patch(
  "/documents/:financialDocumentId",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const provider =
      getFinancialStorageProvider();


    const existing =
      await provider
        .getFinancialDocumentRecord(
          req.params
            .financialDocumentId
        );


    let mergedDocument = {
      ...safeObject(
        existing
          ?.financialDocument
      ),

      ...safeObject(
        req.body
          ?.patch
      ),

      financialDocumentId:
        req.params
          .financialDocumentId
    };

    if (clean(mergedDocument.documentType).toLowerCase() === "payables-control") {
      mergedDocument={...mergedDocument,payablesControl:{...safeObject(mergedDocument.payablesControl),context:{...safeObject(mergedDocument?.payablesControl?.context),entityPassportId:clean(accessContext.entityPassportId),updatedByPassportId:clean(accessContext.actorPassportId)}}};
    }

    if(["treasury-account","treasury-reconciliation"].includes(clean(mergedDocument.documentType).toLowerCase())||clean(mergedDocument?.treasuryMovement?.transactionClass)) return res.status(409).json({ok:false,error:{name:"IXITreasuryImmutableRecordError",message:"Canonical Treasury records are immutable; post a new controlled Treasury event."}});


    const billPatchAction =
      getBillPatchAction(
        safeObject(existing?.financialDocument),
        mergedDocument
      );


    const authorization =
      authorizeFinancialDocumentWrite({
        accessContext,

        action:
          billPatchAction,

        financialDocument:
          mergedDocument
      });


    if (
      !authorization.allowed
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.document.patch",

            action:
              billPatchAction,

          reason:
            authorization.reason,

          details:
            authorization
        })
      );
    }


    const context =
      getRequestContext(
        req
      );


    let boundPatch =
      bindBillActorEvidence(
        safeObject(req.body?.patch),
        billPatchAction,
        accessContext.actorPassportId
      );

    boundPatch = bindPurchaseOrderActorEvidence(
      boundPatch,
      billPatchAction,
      accessContext
    );

    boundPatch = await bindOperationalControlEvidence({
      patch: boundPatch,
      merged: mergedDocument,
      existing: safeObject(existing?.financialDocument),
      action: billPatchAction,
      accessContext
    });

    if (clean(mergedDocument.documentType).toLowerCase() === "payables-control") {
      boundPatch={...boundPatch,payablesControl:mergedDocument.payablesControl};
    }


    return sendEnvelope(
      res,
      await providerService
        .patchDocument({
          ...safeObject(
            req.body
          ),

          patch:
            boundPatch,

          financialDocumentId:
            req.params
              .financialDocumentId,

          ...context,

          actorPassportId:
            accessContext
              .actorPassportId
        })
    );
  }
);


/* =========================================================
   REPLACE
   ========================================================= */

router.put(
  "/documents/:financialDocumentId",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const body =
      safeObject(
        req.body
      );


    const financialDocument = {
      ...safeObject(
        body.financialDocument ||
        body.document
      ),

      financialDocumentId:
        req.params
          .financialDocumentId
    };

    if(["treasury-account","treasury-reconciliation"].includes(clean(financialDocument.documentType).toLowerCase())||clean(financialDocument?.treasuryMovement?.transactionClass)) return res.status(409).json({ok:false,error:{name:"IXITreasuryImmutableRecordError",message:"Canonical Treasury records cannot be replaced; post a new controlled Treasury event."}});


    const authorization =
      authorizeFinancialDocumentWrite({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .REPLACE_DOCUMENT,

        financialDocument
      });


    if (
      !authorization.allowed
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.document.replace",

          action:
            IXI_FINANCIAL_ACTIONS
              .REPLACE_DOCUMENT,

          reason:
            authorization.reason,

          details:
            authorization
        })
      );
    }


    const context =
      getRequestContext(
        req
      );


    return sendEnvelope(
      res,
      await providerService
        .replaceDocument({
          ...body,

          financialDocument,

          ...context,

          actorPassportId:
            accessContext
              .actorPassportId
        })
    );
  }
);


/* =========================================================
   HISTORY
   ========================================================= */

router.get(
  "/documents/:financialDocumentId/history",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const failure =
      await authorizeDocumentRead({
        accessContext,

        financialDocumentId:
          req.params
            .financialDocumentId,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_HISTORY,

        operation:
          "financial.document.history"
      });


    if (
      failure
    ) {
      return sendEnvelope(
        res,
        failure
      );
    }


    return sendEnvelope(
      res,
      await providerService
        .getDocumentHistory({
          financialDocumentId:
            req.params
              .financialDocumentId
        })
    );
  }
);


/* =========================================================
   PASSPORT DOCUMENTS
   ========================================================= */

router.get(
  "/passports/:passportId/documents",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const base =
      authorizeFinancialAction({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_PASSPORT_DOCUMENTS
      });


    if (
      !base.allowed ||
      !canAccessFinancialPassport({
        accessContext,

        passportId:
          req.params
            .passportId
      })
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.passport.documents",

          action:
            IXI_FINANCIAL_ACTIONS
              .VIEW_PASSPORT_DOCUMENTS,

          reason:
            !base.allowed
              ? base.reason
              : "passport-scope-denied"
        })
      );
    }


    return sendEnvelope(
      res,
      await providerService
        .listDocumentsByPassport({
          passportId:
            req.params
              .passportId
        })
    );
  }
);


/* =========================================================
   PASSPORT SNAPSHOT
   ========================================================= */

router.get(
  "/passports/:passportId/snapshot",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const base =
      authorizeFinancialAction({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_PASSPORT_SNAPSHOT
      });


    if (
      !base.allowed ||
      !canAccessFinancialPassport({
        accessContext,

        passportId:
          req.params
            .passportId
      })
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.passport.snapshot",

          action:
            IXI_FINANCIAL_ACTIONS
              .VIEW_PASSPORT_SNAPSHOT,

          reason:
            !base.allowed
              ? base.reason
              : "passport-scope-denied"
        })
      );
    }


    return sendEnvelope(
      res,
      await providerService
        .getPassportSnapshot({
          passportId:
            req.params
              .passportId,

          currency:
            req.query
              ?.currency,

          startAt:
            req.query
              ?.startAt,

          endAt:
            req.query
              ?.endAt,

          includeFacts:
            clean(
              req.query
                ?.includeFacts
            ).toLowerCase() ===
              "true",

          recentActivityLimit:
            req.query
              ?.recentActivityLimit
        })
    );
  }
);


/* =========================================================
   SCOPE SNAPSHOT
   ========================================================= */

router.post(
  "/scopes/snapshot",
  async (
    req,
    res
  ) => {

    const accessContext =
      await getAccess(
        req
      );


    const base =
      authorizeFinancialAction({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_SCOPE_SNAPSHOT
      });


    if (
      !base.allowed
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.scope.snapshot",

          action:
            IXI_FINANCIAL_ACTIONS
              .VIEW_SCOPE_SNAPSHOT,

          reason:
            base.reason
        })
      );
    }


    return sendEnvelope(
      res,
      await providerService
        .getScopeSnapshot(
          req.body
        )
    );
  }
);


/* =========================================================
   TRAN$ACT DESKTOP DASHBOARD
   ========================================================= */

/*
 * POST /financial/dashboard
 *
 * Server-calculated enterprise read model.
 *
 * SECURITY:
 *
 * - authenticated Financial access context
 * - VIEW_SCOPE_SNAPSHOT permission
 * - Passport scope enforcement
 * - no browser supplied authority
 *
 * ACCOUNTING:
 *
 * This route does NOT calculate financial truth.
 *
 * It delegates to the existing authorized
 * Financial Scope Snapshot and packages the
 * resulting canonical Financial + Lifecycle
 * snapshots for TRAN$ACT Desktop.
 */

router.post(
  "/dashboard",
  async (
    req,
    res
  ) => {
    const accessContext =
      normalizeFinancialAccessContext(
        await getAccess(
          req
        )
      );


    const context =
      getRequestContext(
        req
      );


    const requestedQuery =
      safeObject(
        req.body
      );


    const explicitRootPassportId =
      clean(
        requestedQuery.rootPassportId
      );


    const explicitScopePassportIds =
      Array.isArray(
        requestedQuery.scopePassportIds
      )
        ? requestedQuery
            .scopePassportIds
            .map(clean)
            .filter(Boolean)
        : [];


    let discoveredScope =
      null;


    /*
     * Default Desktop behavior:
     *
     * No browser-supplied scope means resolve the
     * authenticated company's permanent production
     * Passport estate server-side.
     */

    if (
      !explicitRootPassportId &&
      !explicitScopePassportIds.length
    ) {
      const financialIdentity =
        req.ixiFinancialIdentity ||
        {};


      discoveredScope =
        await discoverFinancialPassportScope({
          principal:
            req.ixiAuthorityPrincipal,

          aosEntityId:
            financialIdentity.aosEntityId,

          entityPassportId:
            financialIdentity.entityPassportId
        });
    }


    const effectiveQuery = {
      ...requestedQuery,

      rootPassportId:
        explicitRootPassportId ||
        discoveredScope?.rootPassportId ||
        "",

      scopePassportIds:
        explicitScopePassportIds.length
          ? explicitScopePassportIds
          : (
              discoveredScope?.scopePassportIds ||
              []
            )
    };


    /*
     * AUTHORITY → FINANCIAL SCOPE BRIDGE
     *
     * When Desktop scope is discovered server-side,
     * those Passport IDs have already passed:
     *
     *   authenticated Entity ownership
     *   permanent AOS provisioning validation
     *   Authority aos.discover evaluation
     *
     * They therefore become trusted managed
     * Passport scope for THIS request.
     *
     * Browser-supplied Passport IDs do NOT gain
     * this treatment.
     */

    const effectiveAccessContext =
      discoveredScope
        ? {
            ...accessContext,

            managedPassportIds:
              Array.from(
                new Set([
                  ...(
                    Array.isArray(
                      accessContext
                        ?.managedPassportIds
                    )
                      ? accessContext
                          .managedPassportIds
                      : []
                  ),

                  ...(
                    Array.isArray(
                      discoveredScope
                        ?.scopePassportIds
                    )
                      ? discoveredScope
                          .scopePassportIds
                      : []
                  )
                ])
              )
          }
        : accessContext;


    const scopeEnvelope =
      await authorizedFinancialService
        .getScopeSnapshot({
          ...effectiveQuery,

          ...context,

          accessContext:
            effectiveAccessContext
        });


    if (
      !scopeEnvelope?.ok
    ) {
      return sendEnvelope(
        res,
        scopeEnvelope
      );
    }


    const projection =
      createFinancialDashboardProjection({
        scopeSnapshot:
          scopeEnvelope.data,

        query:
          effectiveQuery,

        accessContext:
          effectiveAccessContext
      });


    if (discoveredScope) {
      projection.scopeDiscovery =
        discoveredScope;
    }


    return sendEnvelope(
      res,
      {
        ok:
          true,

        contract:
          "ixi-financial-dashboard",

        contractVersion:
          "1.0.0",

        operation:
          "financial.dashboard.read",

        requestId:
          context.requestId,

        data:
          projection,

        errors:
          [],

        warnings:
          scopeEnvelope.warnings ||
          [],

        metadata: {
          sourceOperation:
            scopeEnvelope.operation,

          sourceRequestId:
            scopeEnvelope.requestId
        }
      }
    );
  }
);


/* =========================================================
   DESKTOP ACCESS CONTEXT
   ========================================================= */

/*
 * GET /financial/access-context
 *
 * Trusted authority projection for IXI TRAN$ACT Desktop.
 *
 * SECURITY:
 * - authority is resolved server-side from the existing
 *   Financial Access Context Bridge
 * - client-supplied roles / permissions are never trusted
 * - this endpoint does not grant authority
 *
 * CURRENT SCOPE:
 * - one trusted entity may be returned from the existing
 *   access context
 * - locations and accounting periods remain empty until
 *   authoritative discovery sources are connected
 */

router.get(
  "/access-context",
  async (
    req,
    res
  ) => {
    const accessContext =
      normalizeFinancialAccessContext(
        await getAccess(
          req
        )
      );


    if (
      !accessContext.authenticated
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.access-context.read",

          reason:
            "authentication-required"
        })
      );
    }


    const entityPassportId =
      clean(
        accessContext
          .entityPassportId
      );


    return res
      .status(200)
      .json({
        ok:
          true,

        contract:
          "ixi-financial-access-context",

        contractVersion:
          "1.0.0",

        operation:
          "financial.access-context.read",

        data: {
          actor: {
            passportId:
              clean(
                accessContext
                  .actorPassportId
              )
          },

          entities:
            entityPassportId
              ? [
                  {
                    passportId:
                      entityPassportId,

                    id:
                      entityPassportId,

                    label:
                      entityPassportId,

                    isDefault:
                      true
                  }
                ]
              : [],

          locations:
            [],

          periods:
            [],

          roles:
            Array.isArray(
              accessContext.roles
            )
              ? accessContext.roles
              : [],

          permissions:
            Array.isArray(
              accessContext.permissions
            )
              ? accessContext.permissions
              : [],

          deniedPermissions:
            Array.isArray(
              accessContext.deniedPermissions
            )
              ? accessContext.deniedPermissions
              : [],

          managedPassportIds:
            Array.isArray(
              accessContext.managedPassportIds
            )
              ? accessContext.managedPassportIds
              : [],

          defaults: {
            entityPassportId,

            locationPassportId:
              "",

            accountingPeriod:
              ""
          },

          metadata: {
            authProvider:
              clean(
                accessContext
                  ?.metadata
                  ?.authProvider
              )
          }
        },

        errors:
          [],

        warnings: [
          {
            name:
              "IXIFinancialAccessContextDiscoveryIncomplete",

            message:
              "Authoritative location and accounting-period discovery are not connected yet."
          }
        ]
      });
  }
);


/* =========================================================
   GENERAL LEDGER
   ========================================================= */

router.get(
  "/gl",
  async (
    req,
    res
  ) => {

    const accessContext =
      normalizeFinancialAccessContext(
        await getAccess(
          req
        )
      );


    const authorization =
      authorizeFinancialAction({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_GENERAL_LEDGER
      });


    if (
      !authorization.allowed
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.gl.read",

          action:
            IXI_FINANCIAL_ACTIONS
              .VIEW_GENERAL_LEDGER,

          reason:
            authorization.reason
        })
      );
    }


    /*
     * Authoritative Financial estate.
     *
     * Browser does not choose Passport scope.
     */

    const entityPassportId =
      clean(
        accessContext
          ?.entityPassportId
      );


    if (!entityPassportId) {
      return res
        .status(400)
        .json({
          ok:
            false,

          contract:
            "ixi-financial-gl",

          contractVersion:
            "1.0.0",

          operation:
            "financial.gl.read",

          data:
            null,

          errors: [
            {
              name:
                "IXIFinancialEntityRequiredError",

              message:
                "Authenticated Financial Entity Passport is required."
            }
          ],

          warnings:
            [],

          metadata:
            {}
        });
    }


    const period =
      clean(
        req.query
          ?.period
      );


    const currency =
      clean(
        req.query
          ?.currency ||
        "USD"
      ).toUpperCase();


    try {

      const result =
        await getFinancialGLProjection({
          entityPassportId,
          period,
          currency
        });


      return res.json({
        ok:
          true,

        contract:
          "ixi-financial-gl",

        contractVersion:
          "1.0.0",

        operation:
          "financial.gl.read",

        data: {
          scope: {
            entityPassportId,

            actorPassportId:
              clean(
                accessContext
                  ?.actorPassportId
              ),

            accountingScope:
              "entity",

            period,

            currency
          },

          ...result,

          lineage: {
            storageProvider:
              result.storageProvider,

            source:
              "ixi-financial-dynamodb",

            serverCalculated:
              true,

            browserCalculated:
              false
          }
        },

        errors:
          [],

        warnings:
          [],

        metadata:
          {}
      });


    } catch (
      error
    ) {

      return res
        .status(500)
        .json({
          ok:
            false,

          contract:
            "ixi-financial-gl",

          contractVersion:
            "1.0.0",

          operation:
            "financial.gl.read",

          data:
            null,

          errors: [
            {
              name:
                clean(
                  error?.name
                ) ||
                "IXIFinancialGLError",

              message:
                clean(
                  error?.message
                ) ||
                "General Ledger projection failed."
            }
          ],

          warnings:
            [],

          metadata:
            {}
        });
    }
  }
);


/* =========================================================
   ENTITY CHART OF ACCOUNTS
   ========================================================= */

/*
 * Canonical Entity-owned accounting account registry.
 *
 * SECURITY:
 * - authenticated Financial access context
 * - Entity resolved server-side
 * - browser cannot choose another Entity
 *
 * This endpoint is READ ONLY.
 */

router.get(
  "/accounts",
  async (
    req,
    res
  ) => {

    const accessContext =
      normalizeFinancialAccessContext(
        await getAccess(
          req
        )
      );


    const authorization =
      authorizeFinancialAction({
        accessContext,

        action:
          IXI_FINANCIAL_ACTIONS
            .VIEW_SCOPE_SNAPSHOT
      });


    if (
      !authorization.allowed
    ) {
      return sendEnvelope(
        res,
        createAuthorizationFailure({
          accessContext,

          operation:
            "financial.accounts.list",

          action:
            IXI_FINANCIAL_ACTIONS
              .VIEW_SCOPE_SNAPSHOT,

          reason:
            authorization.reason
        })
      );
    }


    const entityPassportId =
      clean(
        accessContext
          ?.entityPassportId
      );


    if (!entityPassportId) {
      return res
        .status(400)
        .json({
          ok:
            false,

          contract:
            "ixi-financial-accounts",

          contractVersion:
            "1.0.0",

          operation:
            "financial.accounts.list",

          data:
            null,

          errors: [
            {
              name:
                "IXIFinancialEntityRequiredError",

              message:
                "Authenticated Financial Entity Passport is required."
            }
          ],

          warnings:
            [],

          metadata:
            {}
        });
    }


    try {

      const accounts =
        await financialStore
          .listFinancialAccounts(
            entityPassportId
          );


      return res.json({
        ok:
          true,

        contract:
          "ixi-financial-accounts",

        contractVersion:
          "1.0.0",

        operation:
          "financial.accounts.list",

        data: {
          entityPassportId,

          accounts,

          activeAccounts:
            accounts.filter(
              account =>
                account.active ===
                  true
            ),

          counts: {
            total:
              accounts.length,

            active:
              accounts.filter(
                account =>
                  account.active ===
                    true
              ).length,

            inactive:
              accounts.filter(
                account =>
                  account.active !==
                    true
              ).length
          },

          storageProvider:
            "dynamodb",

          lineage: {
            source:
              "ixi-financial-dynamodb",

            serverCalculated:
              true,

            browserCalculated:
              false
          }
        },

        errors:
          [],

        warnings:
          [],

        metadata:
          {}
      });

    } catch (
      error
    ) {

      return res
        .status(500)
        .json({
          ok:
            false,

          contract:
            "ixi-financial-accounts",

          operation:
            "financial.accounts.list",

          errors: [
            {
              name:
                clean(
                  error?.name ||
                  "IXIFinancialAccountReadError"
                ),

              message:
                clean(
                  error?.message ||
                  "Chart of Accounts could not be loaded."
                )
            }
          ],

          warnings:
            []
        });
    }
  }
);


/* =========================================================
   FINANCIAL COMMANDS
   ========================================================= */

router.use(
  "/commands",
  financialCommandRoutes
);


/* =========================================================
   FALLBACK
   ========================================================= */

router.use(
  (
    req,
    res
  ) => {

    return res
      .status(404)
      .json({
        ok:
          false,

        contract:
          "ixi-financial",

        operation:
          "financial.route.not-found",

        errors: [
          {
            name:
              "IXIFinancialRouteNotFound",

            message:
              `Financial route not found: ${req.method} ${req.originalUrl}`
          }
        ]
      });
  }
);


module.exports =
  router;
