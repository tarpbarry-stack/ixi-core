"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { deliverFinancialDocuments } = require("./IXIFinancialDocumentDelivery");
const { assertPurchaseOrderDelivery } = require("./IXIFinancialDeliveryReceiptControl");
const { createDesktopAccountingProjection } = require("./IXIFinancialDesktopAccountingProjection");
const input = { recipient: "customer@example.com", documentIds: ["ifd_po"], revisions: { ifd_po: 2 }, actorPassportId: "IXIACTOR", entityPassportId: "IXIENTITY", commandId: "test_command_123456", pdfBase64: Buffer.from("%PDF-1.7\nfixture").toString("base64") };
function harness() {
  let sent = 0, pending = false, saved = null;
  return {
    count: () => sent,
    dependencies: {
      authorize: async () => {}, loadDocument: async id => ({ server: { revision: 2 }, financialDocument: { financialDocumentId: id, documentNumber: "PO-1" } }),
      consumeRate: () => {},
      claim: () => { if (saved) return { replayed: true, result: saved }; if (pending) throw new Error("pending"); pending = true; return { acquired: true }; },
      complete: value => { saved = value; },
      sendEmail: async value => { sent++; assert.equal(value.attachments[0].RawContent.subarray(0, 5).toString(), "%PDF-"); return { accepted: true, messageId: "provider-1" }; }
    }
  };
}
test("financial email sends canonical revisions once and returns the same provider receipt on retry", async () => {
  const h = harness();
  const first = await deliverFinancialDocuments(input, h.dependencies);
  const replay = await deliverFinancialDocuments(input, h.dependencies);
  assert.equal(first.status, "accepted"); assert.equal(replay.replayed, true); assert.equal(h.count(), 1);
  assert.deepEqual(replay.messageIds, ["provider-1"]);
});
test("financial email never sends unauthorized or stale documents", async () => {
  const h = harness();
  await assert.rejects(deliverFinancialDocuments({ ...input, revisions: { ifd_po: 1 } }, h.dependencies), /changed/);
  await assert.rejects(deliverFinancialDocuments(input, { ...h.dependencies, authorize: async () => { throw new Error("denied"); } }), /denied/);
  assert.equal(h.count(), 0);
});
test("uncertain email outcome remains pending and cannot dispatch a duplicate", async () => {
  const h = harness(); let count = 0;
  const dependencies = { ...h.dependencies, sendEmail: async () => { count++; throw new Error("timeout after dispatch"); } };
  await assert.rejects(deliverFinancialDocuments(input, dependencies), /not yet confirmed/);
  await assert.rejects(deliverFinancialDocuments(input, dependencies), /pending/);
  assert.equal(count, 1);
});
test("PO sent transition requires a receipt for this actor, entity and exact document", () => {
  const args = { existing: { purchaseOrderRecord: { status: "po-issued" } }, merged: { documentType: "purchase-order", financialDocumentId: "ifd_po", purchaseOrderRecord: { status: "sent", deliveryReceipt: { deliveryId: "receipt-1", recipient: input.recipient } } }, accessContext: input };
  const receipt = { status: "succeeded", passport_id: input.entityPassportId, principal_id: input.actorPassportId, listing_id: "ifd_po", recipients_json: JSON.stringify([input.recipient]), provider_message_ids_json: '["provider-1"]' };
  assert.doesNotThrow(() => assertPurchaseOrderDelivery({ ...args, getDelivery: () => receipt }));
  for (const patch of [{ status: "pending" }, { passport_id: "OTHER" }, { principal_id: "OTHER" }, { listing_id: "ifd_other" }]) assert.throws(() => assertPurchaseOrderDelivery({ ...args, getDelivery: () => ({ ...receipt, ...patch }) }), /could not be verified/);
});
test("dashboard accounting is the posted GL, independent of operational inflow", () => {
  const reports = createDesktopAccountingProjection({ projection: { profitAndLoss: { revenue: 0, netIncome: -76 }, totals: { inflow: 314000 }, journal: [{ financialDocumentId: "ifd_journal" }], controls: { closeCertification: { exceptions: [{ code: "AR_SUBLEDGER_GL_DIFFERENCE", amount: 120 }] } } }, documents: [{ documentType: "invoice", financialDocumentId: "ifd_invoice" }, { documentType: "bill", financialDocumentId: "ifd_bill" }] });
  assert.equal(reports.executive.revenue, 0); assert.equal(reports.executive.netIncome, -76);
  assert.equal(reports.gl.journals[0].financialDocumentId, "ifd_journal"); assert.equal(reports.ar.records[0].financialDocumentId, "ifd_invoice");
  assert.equal(reports.reports.closeReview.data.exceptions.length, 1);
  assert.equal(createDesktopAccountingProjection().executive.revenue, null);
});
