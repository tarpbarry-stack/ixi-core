"use strict";

const crypto = require("crypto");
const providerService = require("../financial/IXIFinancialProviderService");
const { executeCreateFinancialDocumentCommand } = require("../financial/IXIFinancialCommandEngine");
const { createSalesSigningToken, verifySalesSigningToken } = require("./IXISalesSigningToken");

const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const nowIso = () => new Date().toISOString();
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
  return value;
}

function packageSnapshot(order = {}) {
  return stable({
    schema: clean(order.schema),
    identity: object(order.identity),
    brand: object(order.brand),
    customer: object(order.customer),
    asset: object(order.asset),
    commercial: object(order.commercial),
    totals: object(order.totals),
    termsDocument: object(order.termsDocument)
  });
}

function getRecord(envelope = {}) { return envelope?.data?.record || envelope?.record || null; }

function workflowErrorMessage(envelope = {}, fallback = "Sales workflow could not be completed.") {
  const first = array(envelope?.errors)[0];
  return clean(typeof first === "string" ? first : first?.message) || fallback;
}

function publicOrder(order = {}) {
  return {
    schema: order.schema,
    identity: { salesOrderId: order?.identity?.salesOrderId, number: order?.identity?.number, revision: order?.identity?.revision },
    brand: order.brand,
    customer: order.customer,
    asset: order.asset,
    commercial: order.commercial,
    totals: order.totals,
    termsDocument: order.termsDocument,
    signing: { status: order?.signing?.status, expiresAt: order?.signing?.expiresAt, signedAt: order?.signing?.signedAt },
    related: order.related,
    status: order.status
  };
}

function assertSignable(document = {}, claims = {}, serverRevision = 0) {
  if (clean(document.documentType) !== "sales-order") throw new Error("Signing link does not reference a Sales Order.");
  const order = object(document.salesOrder);
  if (clean(order?.identity?.salesOrderId) !== clean(claims.salesOrderId)) throw new Error("Signing link does not match this Sales Order.");
  if (Number(order?.signing?.tokenVersion) !== Number(claims.tokenVersion)) throw Object.assign(new Error("Signing link has been replaced."), { name: "IXISalesSigningTokenSupersededError" });
  if (!["sent-for-signature", "viewed", "signed-invoice-pending", "signed"].includes(clean(order.status))) throw new Error("Sales Order is not available for signature.");
  if (["sent-for-signature", "viewed"].includes(clean(order.status)) && Number(serverRevision) !== Number(claims.revision)) throw Object.assign(new Error("Sales Order changed after this signing link was created."), { name: "IXISalesSigningTokenSupersededError" });
  return order;
}

function createInvitation({ financialDocument, revision, expiresInHours = 168, idempotencyKey = "" } = {}) {
  const order = object(financialDocument?.salesOrder);
  const priorSigning = object(order.signing);
  const requestKey = clean(idempotencyKey);
  if (requestKey && requestKey === clean(priorSigning.invitationIdempotencyKey)) {
    return {
      token: createSalesSigningToken({ salesOrderId: financialDocument?.financialDocumentId, revision: Number(priorSigning.invitationRevision), tokenVersion: Number(priorSigning.tokenVersion), expiresAt: priorSigning.expiresAt, nonce: priorSigning.tokenNonce }),
      expiresAt: priorSigning.expiresAt,
      tokenVersion: Number(priorSigning.tokenVersion),
      patch: null,
      idempotentReplay: true
    };
  }
  const tokenVersion = Number(order?.signing?.tokenVersion || 0) + 1;
  const expiresAt = new Date(Date.now() + Math.min(Math.max(Number(expiresInHours) || 168, 1), 720) * 3600000).toISOString();
  const invitationRevision = Number(revision) + 1;
  const tokenNonce = requestKey ? hash(`${requestKey}|${clean(financialDocument?.financialDocumentId)}`).slice(0, 32) : crypto.randomBytes(16).toString("hex");
  const token = createSalesSigningToken({ salesOrderId: financialDocument?.financialDocumentId, revision: invitationRevision, tokenVersion, expiresAt, nonce: tokenNonce });
  return {
    token,
    expiresAt,
    tokenVersion,
    patch: {
      ...order,
      status: "sent-for-signature",
      signing: { ...object(order.signing), status: "sent", tokenVersion, tokenNonce, invitationRevision, invitationIdempotencyKey: requestKey, expiresAt, sentAt: nowIso(), viewedAt: "", signedAt: "", signedPackageHash: "" },
      activity: [...array(order.activity), { eventId: `SO-SEND-${Date.now()}`, type: "sales-order-sent-for-signature", occurredAt: nowIso() }]
    }
  };
}

function signOrder(order = {}, input = {}, evidence = {}) {
  const signerName = clean(input.signerName);
  const signerTitle = clean(input.signerTitle);
  const signerDate = clean(input.signerDate);
  const signatureValue = clean(input.signatureValue);
  if (input.consent !== true || signerName.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(signerDate) || signatureValue.length < 2) throw Object.assign(new Error("Name, date, signature, and agreement are required."), { name: "IXISalesSignatureValidationError" });
  const signedAt = nowIso();
  const snapshot = packageSnapshot(order);
  const sourcePackageHash = hash(JSON.stringify(snapshot));
  const signatureHash = hash(JSON.stringify(stable({ signerName, signerTitle, signerDate, signatureValue, sourcePackageHash, signedAt })));
  const signedPackageHash = hash(`${sourcePackageHash}|${signatureHash}`);
  return {
    ...order,
    status: "signed-invoice-pending",
    signing: {
      ...object(order.signing),
      status: "signed",
      signerName,
      signerTitle,
      signerDate,
      signatureType: clean(input.signatureType || "typed"),
      signatureValue,
      signedAt,
      sourcePackageHash,
      signatureHash,
      signedPackageHash,
      evidence: { sourceIp: clean(evidence.sourceIp), userAgent: clean(evidence.userAgent), requestId: clean(evidence.requestId) },
      snapshot
    },
    activity: [...array(order.activity), { eventId: `SO-SIGN-${Date.now()}`, type: "sales-order-signed", occurredAt: signedAt, signerName, signedPackageHash }],
    audit: { ...object(order.audit), updatedAt: signedAt }
  };
}

function attestExternalSignature(order = {}, input = {}, evidence = {}) {
  const signerName = clean(input.signerName);
  const signerTitle = clean(input.signerTitle);
  const signerDate = clean(input.signerDate);
  const receivedVia = clean(input.receivedVia).toLowerCase();
  const externalReference = clean(input.externalReference);
  const attestedByPassportId = clean(evidence.actorPassportId);
  if (
    input.attestation !== true ||
    signerName.length < 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(signerDate) ||
    !["email", "paper", "other"].includes(receivedVia) ||
    !attestedByPassportId
  ) {
    throw Object.assign(
      new Error("Signer, signed date, receipt method, authenticated actor, and signed-copy attestation are required."),
      { name: "IXISalesManualSignatureValidationError" },
    );
  }
  const attestedAt = nowIso();
  const snapshot = packageSnapshot(order);
  const sourcePackageHash = hash(JSON.stringify(snapshot));
  const signatureHash = hash(JSON.stringify(stable({
    signerName,
    signerTitle,
    signerDate,
    receivedVia,
    externalReference,
    sourcePackageHash,
    attestedAt,
    attestedByPassportId,
  })));
  const signedPackageHash = hash(`${sourcePackageHash}|${signatureHash}`);
  return {
    ...order,
    status: "signed-invoice-pending",
    signing: {
      ...object(order.signing),
      status: "signed",
      signerName,
      signerTitle,
      signerDate,
      signatureType: "external-document-attestation",
      signatureValue: "SIGNED COPY ATTESTED ON FILE",
      receivedVia,
      externalReference,
      signedAt: attestedAt,
      attestedAt,
      attestedByPassportId,
      sourcePackageHash,
      signatureHash,
      signedPackageHash,
      evidence: {
        sourceIp: clean(evidence.sourceIp),
        userAgent: clean(evidence.userAgent),
        requestId: clean(evidence.requestId),
      },
      snapshot,
    },
    activity: [
      ...array(order.activity),
      {
        eventId: `SO-MANUAL-SIGN-${Date.now()}`,
        type: "sales-order-signature-attested",
        occurredAt: attestedAt,
        signerName,
        signerDate,
        receivedVia,
        externalReference,
        attestedByPassportId,
        signedPackageHash,
      },
    ],
    audit: { ...object(order.audit), updatedAt: attestedAt, updatedBy: attestedByPassportId },
  };
}

function invoiceInput(order = {}, salesOrderId = "", references = []) {
  const total = Number(order?.totals?.total || 0);
  return {
    financialState: "draft",
    currency: clean(order?.commercial?.currency || "USD"),
    occurredAt: nowIso(),
    dueDate: clean(order?.commercial?.dueDate),
    description: `Equipment Invoice · ${clean(order?.asset?.label)} · ${clean(order?.customer?.name)}`,
    amount: total,
    quantity: 1,
    rate: total,
    category: "equipment-sale",
    customerPassportId: clean(order?.customer?.passportId),
    issuedByPassportId: clean(order?.context?.actorPassportId),
    paymentTerms: clean(order?.commercial?.paymentTerms),
    sourceFinancialDocumentId: clean(salesOrderId),
    references: array(references),
    metadata: {
      transactModule: "equipment-sale",
      invoiceType: "asset-sale",
      invoiceStatus: "draft",
      salesOrderId: clean(salesOrderId),
      salesOrderNumber: clean(order?.identity?.number),
      signedPackageHash: clean(order?.signing?.signedPackageHash),
      commercialBreakdown: object(order?.totals),
      customer: object(order?.customer),
      asset: object(order?.asset),
      brand: object(order?.brand)
    }
  };
}

async function loadExistingInvoice(invoiceId = "") {
  const id = clean(invoiceId);
  if (!id) return null;
  const loaded = await providerService.getDocument({ financialDocumentId: id });
  if (!loaded?.ok) throw new Error(loaded?.errors?.[0]?.message || "Linked Invoice could not be loaded.");
  return getRecord(loaded)?.financialDocument || null;
}

async function ensureDraftInvoice({
  financialDocument = {},
  sourceRecord = {},
  order = {},
  actorPassportId = "",
  entityPassportId = "",
  requestId = "",
  source = "ixi-sales-order-workflow",
} = {}) {
  const salesOrderId = clean(financialDocument.financialDocumentId || order?.identity?.salesOrderId);
  if (!salesOrderId) throw new Error("Sales Order identity is required before generating its Invoice.");
  const linkedInvoiceId = clean(order?.related?.invoiceId);
  if (linkedInvoiceId) {
    const invoice = await loadExistingInvoice(linkedInvoiceId);
    return { order, invoice, sourceRecord, idempotentReplay: true };
  }

  const invoiceResult = await executeCreateFinancialDocumentCommand({
    documentType: "invoice",
    input: invoiceInput(order, salesOrderId, financialDocument.references),
    actorPassportId: clean(actorPassportId || order?.context?.actorPassportId) || "ixi-system-sales-order",
    entityPassportId: clean(entityPassportId || order?.context?.entityPassportId),
    commandId: `invoice-${hash(salesOrderId).slice(0, 24)}`,
    idempotencyKey: `ixi-sales-order-invoice:${salesOrderId}`,
    source,
    requestId: clean(requestId),
    snapshot: { mode: "passport", passportId: clean(order?.context?.primaryPassportId) },
    metadata: { transactModule: "equipment-sale", generatedFromSalesOrder: true },
  });
  if (!invoiceResult?.ok) throw new Error(invoiceResult?.errors?.[0]?.message || "Linked draft Invoice generation failed.");
  const invoiceRecord = invoiceResult?.data?.record || invoiceResult?.record || {};
  const invoice = invoiceRecord?.financialDocument || invoiceResult?.financialDocument || {};
  const generatedAt = nowIso();
  const linkedOrder = {
    ...order,
    related: {
      ...object(order.related),
      invoiceId: clean(invoice.financialDocumentId),
      invoiceNumber: clean(invoice.documentNumber),
    },
    activity: [
      ...array(order.activity),
      {
        eventId: `SO-INVOICE-${Date.now()}`,
        type: "draft-invoice-generated",
        occurredAt: generatedAt,
        invoiceId: clean(invoice.financialDocumentId),
        invoiceNumber: clean(invoice.documentNumber),
      },
    ],
    audit: { ...object(order.audit), updatedAt: generatedAt },
  };
  const linked = await providerService.patchDocument({
    financialDocumentId: salesOrderId,
    patch: {
      salesOrder: linkedOrder,
      accountingTreatment: { ...object(financialDocument.accountingTreatment), invoiceGenerated: true },
    },
    actorPassportId: clean(actorPassportId || order?.context?.actorPassportId) || "ixi-system-sales-order",
    expectedRevision: Number(sourceRecord?.server?.revision),
    commandId: `link-${hash(`${salesOrderId}|${clean(invoice.financialDocumentId)}`).slice(0, 24)}`,
    idempotencyKey: `ixi-sales-order-link-invoice:${salesOrderId}:${clean(invoice.financialDocumentId)}`,
    metadata: { source, generatedInvoiceId: clean(invoice.financialDocumentId) },
    source,
  });
  if (!linked?.ok) throw new Error(linked?.errors?.[0]?.message || "Invoice was generated; Sales Order lineage update failed.");
  return {
    order: getRecord(linked)?.financialDocument?.salesOrder || linkedOrder,
    invoice,
    sourceRecord: getRecord(linked) || sourceRecord,
    idempotentReplay: invoiceResult?.idempotentReplay === true,
  };
}

async function ensureInvoiceForSalesOrder(financialDocumentId, evidence = {}) {
  const loaded = await providerService.getDocument({ financialDocumentId: clean(financialDocumentId) });
  if (!loaded?.ok) throw new Error(loaded?.errors?.[0]?.message || "Sales Order could not be loaded.");
  const sourceRecord = getRecord(loaded);
  const financialDocument = sourceRecord?.financialDocument || {};
  if (clean(financialDocument.documentType).toLowerCase() !== "sales-order") throw new Error("Invoice generation requires a Sales Order.");
  return ensureDraftInvoice({
    financialDocument,
    sourceRecord,
    order: object(financialDocument.salesOrder),
    actorPassportId: evidence.actorPassportId,
    entityPassportId: evidence.entityPassportId,
    requestId: evidence.requestId,
  });
}

async function completeExternalSignature(financialDocumentId, input = {}, evidence = {}) {
  const loaded = await providerService.getDocument({ financialDocumentId: clean(financialDocumentId) });
  if (!loaded?.ok) throw new Error(loaded?.errors?.[0]?.message || "Sales Order could not be loaded.");
  let sourceRecord = getRecord(loaded);
  let financialDocument = sourceRecord?.financialDocument || {};
  if (clean(financialDocument.documentType).toLowerCase() !== "sales-order") throw new Error("Manual signature attestation requires a Sales Order.");
  let order = object(financialDocument.salesOrder);
  const suppliedInvoiceId = clean(input.existingInvoiceId);
  if (!clean(order?.related?.invoiceId) && suppliedInvoiceId) {
    const suppliedInvoice = await loadExistingInvoice(suppliedInvoiceId);
    const invoiceSalesOrderId = clean(suppliedInvoice?.sourceFinancialDocumentId || suppliedInvoice?.metadata?.salesOrderId);
    if (invoiceSalesOrderId !== clean(financialDocumentId)) {
      throw Object.assign(new Error("The selected Invoice is not linked to this Sales Order."), { name: "IXISalesInvoiceLineageError" });
    }
    order = {
      ...order,
      related: {
        ...object(order.related),
        invoiceId: suppliedInvoiceId,
        invoiceNumber: clean(suppliedInvoice?.documentNumber),
      },
    };
  }
  if (clean(order.status).toLowerCase() === "signed" && clean(order?.signing?.signedPackageHash)) {
    const invoice = await loadExistingInvoice(order?.related?.invoiceId);
    return { order: publicOrder(order), invoice, idempotentReplay: true };
  }

  order = attestExternalSignature(order, input, evidence);
  const signed = await providerService.patchDocument({
    financialDocumentId: clean(financialDocumentId),
    patch: { salesOrder: order, accountingTreatment: { ...object(financialDocument.accountingTreatment), invoiceGenerated: Boolean(clean(order?.related?.invoiceId)) } },
    actorPassportId: clean(evidence.actorPassportId),
    expectedRevision: Number(sourceRecord?.server?.revision),
    commandId: clean(input.commandId) || `manual-sign-${clean(order?.signing?.signatureHash).slice(0, 24)}`,
    idempotencyKey: clean(input.idempotencyKey) || `ixi-sales-order-manual-sign:${clean(order?.signing?.signedPackageHash)}`,
    metadata: { source: "ixi-sales-manual-signature", requestId: clean(evidence.requestId) },
    source: "ixi-sales-manual-signature",
    sourceIp: clean(evidence.sourceIp),
    userAgent: clean(evidence.userAgent),
  });
  if (!signed?.ok) throw new Error(workflowErrorMessage(signed, "Manual signature attestation could not be saved."));
  sourceRecord = getRecord(signed);
  financialDocument = sourceRecord.financialDocument;
  order = financialDocument.salesOrder;
  const ensured = await ensureDraftInvoice({
    financialDocument,
    sourceRecord,
    order,
    actorPassportId: evidence.actorPassportId,
    entityPassportId: evidence.entityPassportId,
    requestId: evidence.requestId,
    source: "ixi-sales-manual-signature",
  });
  sourceRecord = ensured.sourceRecord;
  order = ensured.order;
  const completedAt = nowIso();
  const completedOrder = {
    ...order,
    status: "signed",
    signing: { ...object(order.signing), invoiceGeneratedAt: clean(order?.signing?.invoiceGeneratedAt || completedAt) },
    audit: { ...object(order.audit), updatedAt: completedAt, updatedBy: clean(evidence.actorPassportId) },
  };
  const finalized = await providerService.patchDocument({
    financialDocumentId: clean(financialDocumentId),
    patch: { salesOrder: completedOrder, accountingTreatment: { ...object(sourceRecord?.financialDocument?.accountingTreatment), invoiceGenerated: true } },
    actorPassportId: clean(evidence.actorPassportId),
    expectedRevision: Number(sourceRecord?.server?.revision),
    commandId: `manual-finalize-${clean(order?.signing?.signatureHash).slice(0, 24)}`,
    idempotencyKey: `ixi-sales-order-manual-finalize:${clean(financialDocumentId)}:${clean(ensured.invoice?.financialDocumentId)}`,
    metadata: { source: "ixi-sales-manual-signature", generatedInvoiceId: clean(ensured.invoice?.financialDocumentId) },
    source: "ixi-sales-manual-signature",
  });
  if (!finalized?.ok) throw new Error(finalized?.errors?.[0]?.message || "Signature was recorded; Sales Order finalization failed.");
  return {
    order: publicOrder(getRecord(finalized)?.financialDocument?.salesOrder || completedOrder),
    invoice: ensured.invoice,
    idempotentReplay: ensured.idempotentReplay,
  };
}

async function loadByToken(token) {
  const claims = verifySalesSigningToken(token);
  const envelope = await providerService.getDocument({ financialDocumentId: claims.salesOrderId });
  if (!envelope?.ok) throw new Error(envelope?.errors?.[0]?.message || "Sales Order could not be loaded.");
  const record = getRecord(envelope);
  const order = assertSignable(record?.financialDocument, claims, record?.server?.revision);
  return { claims, record, order: publicOrder(order) };
}

async function completeByToken(token, input = {}, evidence = {}) {
  const claims = verifySalesSigningToken(token);
  const loaded = await providerService.getDocument({ financialDocumentId: claims.salesOrderId });
  if (!loaded?.ok) throw new Error(loaded?.errors?.[0]?.message || "Sales Order could not be loaded.");
  let sourceRecord = getRecord(loaded);
  let document = sourceRecord.financialDocument;
  let order = assertSignable(document, claims, sourceRecord?.server?.revision);
  if (order.status === "signed" && clean(order?.related?.invoiceId)) return { order: publicOrder(order), invoice: { financialDocumentId: order.related.invoiceId, documentNumber: order.related.invoiceNumber }, idempotentReplay: true };

  if (order.status !== "signed-invoice-pending") {
    order = signOrder(order, input, evidence);
    const patched = await providerService.patchDocument({
      financialDocumentId: claims.salesOrderId,
      patch: { salesOrder: order, accountingTreatment: { ...object(document.accountingTreatment), invoiceGenerated: false } },
      actorPassportId: `external-signer:${hash(clean(input.signerName)).slice(0, 16)}`,
      expectedRevision: Number(sourceRecord?.server?.revision),
      commandId: `sign-${clean(order?.signing?.signatureHash).slice(0, 24)}`,
      idempotencyKey: `ixi-sales-order-sign:${clean(order?.signing?.signedPackageHash)}`,
      metadata: { source: "ixi-sales-signing", requestId: clean(evidence.requestId) },
      source: "ixi-sales-signing",
      sourceIp: clean(evidence.sourceIp),
      userAgent: clean(evidence.userAgent)
    });
    if (!patched?.ok) throw new Error(patched?.errors?.[0]?.message || "Signed Sales Order could not be saved.");
    sourceRecord = getRecord(patched);
    document = sourceRecord.financialDocument;
    order = document.salesOrder;
  }

  const ensured = await ensureDraftInvoice({
    financialDocument: document,
    sourceRecord,
    order,
    actorPassportId: clean(order?.context?.actorPassportId) || "ixi-system-sales-signing",
    entityPassportId: clean(order?.context?.entityPassportId),
    requestId: clean(evidence.requestId),
    source: "ixi-sales-signing",
  });
  sourceRecord = ensured.sourceRecord;
  document = sourceRecord.financialDocument;
  order = ensured.order;
  const invoice = ensured.invoice;
  const completedAt = nowIso();
  const completedOrder = {
    ...order,
    status: "signed",
    signing: { ...object(order.signing), invoiceGeneratedAt: completedAt },
    related: { ...object(order.related), invoiceId: clean(invoice.financialDocumentId), invoiceNumber: clean(invoice.documentNumber) },
    activity: array(order.activity),
    audit: { ...object(order.audit), updatedAt: completedAt }
  };
  const finalized = await providerService.patchDocument({
    financialDocumentId: claims.salesOrderId,
    patch: { salesOrder: completedOrder, accountingTreatment: { ...object(document.accountingTreatment), invoiceGenerated: true } },
    actorPassportId: "ixi-system-sales-signing",
    expectedRevision: Number(sourceRecord?.server?.revision),
    commandId: `finalize-${clean(order?.signing?.signedPackageHash).slice(0, 24)}`,
    idempotencyKey: `ixi-sales-order-finalize:${claims.salesOrderId}:${clean(invoice.financialDocumentId)}`,
    metadata: { source: "ixi-sales-signing", generatedInvoiceId: clean(invoice.financialDocumentId) },
    source: "ixi-sales-signing"
  });
  if (!finalized?.ok) throw new Error(finalized?.errors?.[0]?.message || "Invoice was generated; Sales Order finalization is pending.");
  return { order: publicOrder(getRecord(finalized)?.financialDocument?.salesOrder || completedOrder), invoice: { financialDocumentId: invoice.financialDocumentId, documentNumber: invoice.documentNumber, financialState: invoice.financialState }, idempotentReplay: ensured.idempotentReplay === true };
}

module.exports = {
  packageSnapshot,
  publicOrder,
  createInvitation,
  signOrder,
  attestExternalSignature,
  invoiceInput,
  ensureDraftInvoice,
  ensureInvoiceForSalesOrder,
  completeExternalSignature,
  loadByToken,
  completeByToken,
};
