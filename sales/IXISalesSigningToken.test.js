"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSalesSigningToken, verifySalesSigningToken } = require("./IXISalesSigningToken");
const { signOrder, invoiceInput, createInvitation } = require("./IXISalesSigningService");

test("sales signing token is scoped, expiring, and tamper evident", () => {
  process.env.IXI_SALES_SIGNING_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
  const token = createSalesSigningToken({ salesOrderId: "ifd_order001", revision: 3, tokenVersion: 2, expiresAt: "2030-01-01T00:00:00.000Z", nonce: "fixed" });
  assert.equal(verifySalesSigningToken(token, { now: Date.parse("2029-01-01") }).salesOrderId, "ifd_order001");
  assert.throws(() => verifySalesSigningToken(`${token}x`, { now: Date.parse("2029-01-01") }), /invalid/i);
  assert.throws(() => verifySalesSigningToken(token, { now: Date.parse("2031-01-01") }), /expired/i);
});

test("signature freezes the agreed package and invoice inherits the signed total", () => {
  const order = {
    schema: "ixi-equipment-sales-order-v1",
    identity: { salesOrderId: "ifd_order001", number: "SO-1001", revision: 1 },
    context: { primaryPassportId: "pass_machine", entityPassportId: "pass_entity", actorPassportId: "pass_actor" },
    brand: { companyName: "Dealer" },
    customer: { name: "Buyer" },
    asset: { label: "2022 CAT 336", serialNumber: "CAT00336" },
    commercial: { currency: "USD", paymentTerms: "Due before release" },
    totals: { subtotal: 185000, tax: 0, freight: 2750, fees: 250, tradeAllowance: 80000, deposit: 10000, total: 108000, balanceDue: 98000 },
    termsDocument: { documentId: "terms-v4", sha256: "a".repeat(64), url: "https://example.com/terms.pdf", pageCount: 2 },
    signing: { tokenVersion: 1 }, related: {}, activity: [], audit: {}, status: "sent-for-signature"
  };
  const signed = signOrder(order, { signerName: "Jane Buyer", signerTitle: "Owner", signerDate: "2026-09-04", signatureValue: "Jane Buyer", consent: true }, {});
  assert.equal(signed.status, "signed-invoice-pending");
  assert.match(signed.signing.signedPackageHash, /^[a-f0-9]{64}$/);
  const invoice = invoiceInput(signed, "ifd_order001");
  assert.equal(invoice.amount, 108000);
  assert.equal(invoice.financialState, "draft");
  assert.equal(invoice.sourceFinancialDocumentId, "ifd_order001");
});

test("signing invitation retries return the same token without creating a new version", () => {
  const financialDocument = { financialDocumentId: "ifd_so1", documentType: "sales-order", salesOrder: { identity: { salesOrderId: "ifd_so1" }, signing: { tokenVersion: 0 }, status: "ready-for-signature" } };
  const first = createInvitation({ financialDocument, revision: 4, idempotencyKey: "invite-once" });
  const replayDocument = { ...financialDocument, salesOrder: first.patch };
  const replay = createInvitation({ financialDocument: replayDocument, revision: 5, idempotencyKey: "invite-once" });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.token, first.token);
  assert.equal(replay.tokenVersion, 1);
});
