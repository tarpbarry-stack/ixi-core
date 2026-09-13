"use strict";
const crypto = require("node:crypto");
const clean = value => String(value ?? "").trim();
const fail = (code, message, status = 400) => { const error = new Error(message); Object.assign(error, { code, status }); throw error; };

async function deliverFinancialDocuments(input, dependencies) {
  const { loadDocument, authorize, claim, complete, consumeRate, sendEmail, failDelivery } = dependencies;
  const recipient = clean(input.recipient).toLowerCase();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient) || recipient.length > 254) fail("INVALID_RECIPIENT", "Enter one valid recipient email address.");
  const ids = [...new Set((Array.isArray(input.documentIds) ? input.documentIds : []).map(clean))];
  if (!ids.length || ids.length > 100 || ids.some(id => !/^ifd_[a-zA-Z0-9_-]+$/.test(id))) fail("INVALID_DOCUMENTS", "Select one to 100 saved transactions.");
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(clean(input.commandId))) fail("INVALID_SEND_TOKEN", "A valid send token is required.");
  const content = Buffer.from(clean(input.pdfBase64), "base64");
  if (content.length > 8 * 1024 * 1024 || content.subarray(0, 5).toString() !== "%PDF-") fail("INVALID_DOCUMENT_PDF", "A generated transaction PDF is required (maximum 8 MB).");
  const records = [];
  for (const id of ids) {
    await authorize(id);
    const record = await loadDocument(id);
    if (!record?.financialDocument) fail("DOCUMENT_NOT_FOUND", "A selected transaction is no longer available.", 404);
    if (Number(record.server?.revision) !== Number(input.revisions?.[id])) fail("DOCUMENT_CHANGED", "A transaction changed. Refresh the selection before sending.", 409);
    records.push(record);
  }
  const key = `transact-${input.entityPassportId}-${input.commandId}`;
  // Stable across retries: PDF timestamps/encoding must not invalidate the
  // identity of a send of these exact canonical revisions to this recipient.
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ entity: input.entityPassportId, actor: input.actorPassportId, recipient, ids, revisions: input.revisions })).digest("hex");
  consumeRate({ principalId: input.actorPassportId });
  const delivery = claim({ idempotencyKey: key, fingerprint, passportId: input.entityPassportId, listingId: ids.join(","), principalId: input.actorPassportId, recipients: [recipient], allowPendingRetry: false });
  if (delivery.replayed) return { deliveryId: key, status: "accepted", recipient, messageIds: delivery.result.messageIds, replayed: true };
  const names = records.map(record => record.financialDocument.documentNumber || record.financialDocument.financialDocumentId);
  // After dispatch begins, retain pending on any ambiguous failure. Replaying
  // the same command must never cause a second email after an unknown result.
  let result;
  try {
    result = await sendEmail({ to: recipient, subject: `IXI TRAN$ACT · ${ids.length === 1 ? names[0] : `${ids.length} transactions`}`, text: `Your transaction documents are attached as a PDF.\n\n${names.join("\n")}`, html: "<p>Your IXI TRAN$ACT documents are attached as a PDF.</p>", fromName: "IXI TRAN$ACT", attachments: [{ FileName: "IXI-TRANSACT.pdf", ContentType: "application/pdf", ContentDisposition: "ATTACHMENT", ContentTransferEncoding: "BASE64", RawContent: content }] });
    if (!result?.accepted || !result.messageId) throw new Error("Provider receipt unavailable.");
    complete({ idempotencyKey: key, messageIds: [result.messageId] });
  } catch (error) {
    const status = Number(error?.$metadata?.httpStatusCode);
    if (status >= 400 && status < 500 && failDelivery) {
      failDelivery({ idempotencyKey: key, code: error.name || "PROVIDER_REJECTED" });
      fail("DELIVERY_REJECTED", "The email provider rejected this send. No accepted receipt was returned. Check the recipient and retry.", 502);
    }
    fail("DELIVERY_RESULT_PENDING", "The email result is not yet confirmed. Keep this send token; do not start a second send.", 409);
  }
  return { deliveryId: key, status: "accepted", recipient, messageIds: [result.messageId], replayed: false };
}

module.exports = { deliverFinancialDocuments };
