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

  const invoiceResult = await executeCreateFinancialDocumentCommand({
    documentType: "invoice",
    input: invoiceInput(order, claims.salesOrderId, document.references),
    actorPassportId: clean(order?.context?.actorPassportId) || "ixi-system-sales-signing",
    entityPassportId: clean(order?.context?.entityPassportId),
    commandId: `invoice-${clean(order?.signing?.signedPackageHash).slice(0, 24)}`,
    idempotencyKey: `ixi-sales-order-invoice:${claims.salesOrderId}:${clean(order?.signing?.signedPackageHash)}`,
    source: "ixi-sales-signing",
    requestId: clean(evidence.requestId),
    snapshot: { mode: "passport", passportId: clean(order?.context?.primaryPassportId) },
    metadata: { transactModule: "equipment-sale", generatedFromSignedSalesOrder: true }
  });
  if (!invoiceResult?.ok) throw new Error(invoiceResult?.errors?.[0]?.message || "Draft Invoice generation is pending.");
  const invoiceRecord = invoiceResult?.data?.record || invoiceResult?.record || {};
  const invoice = invoiceRecord?.financialDocument || invoiceResult?.financialDocument || {};
  const completedAt = nowIso();
  const completedOrder = {
    ...order,
    status: "signed",
    signing: { ...object(order.signing), invoiceGeneratedAt: completedAt },
    related: { ...object(order.related), invoiceId: clean(invoice.financialDocumentId), invoiceNumber: clean(invoice.documentNumber) },
    activity: [...array(order.activity), { eventId: `SO-INVOICE-${Date.now()}`, type: "draft-invoice-generated", occurredAt: completedAt, invoiceId: clean(invoice.financialDocumentId), invoiceNumber: clean(invoice.documentNumber) }],
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
  return { order: publicOrder(getRecord(finalized)?.financialDocument?.salesOrder || completedOrder), invoice: { financialDocumentId: invoice.financialDocumentId, documentNumber: invoice.documentNumber, financialState: invoice.financialState }, idempotentReplay: invoiceResult?.idempotentReplay === true };
}

module.exports = { packageSnapshot, publicOrder, createInvitation, signOrder, invoiceInput, loadByToken, completeByToken };
