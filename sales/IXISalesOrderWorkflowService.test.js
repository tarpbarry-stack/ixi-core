"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("Sales Order creation and manual signature reuse exactly one linked Invoice", async () => {
  const records = new Map();
  let invoiceCreates = 0;
  const salesOrderId = "ifd_sales_order_1";
  records.set(salesOrderId, {
    server: { revision: 1 },
    financialDocument: {
      financialDocumentId: salesOrderId,
      documentType: "sales-order",
      references: [{ passportId: "pass_machine", role: "asset" }],
      accountingTreatment: { invoiceGenerated: false },
      salesOrder: {
        schema: "ixi-equipment-sales-order-v1",
        identity: { salesOrderId, financialDocumentId: salesOrderId, number: "SO-1001", revision: 1 },
        context: { primaryPassportId: "pass_machine", entityPassportId: "pass_entity", actorPassportId: "pass_actor" },
        customer: { name: "Clements Farm", contactName: "Keith", email: "buyer@example.com" },
        asset: { label: "2017 Deere 544K II", serialNumber: "1DW544KZCHF681737" },
        commercial: { currency: "USD", paymentTerms: "Wire before release" },
        totals: { subtotal: 82000, total: 82000, balanceDue: 82000 },
        termsDocument: { documentId: "terms-v4", sha256: "a".repeat(64), url: "https://example.com/terms.pdf", pageCount: 2 },
        signing: {}, related: {}, activity: [], audit: {}, status: "draft",
      },
    },
  });

  const provider = {
    async getDocument({ financialDocumentId }) {
      const record = records.get(financialDocumentId);
      return record ? { ok: true, data: { record } } : { ok: false, errors: [{ message: "not found" }] };
    },
    async patchDocument({ financialDocumentId, patch, expectedRevision }) {
      const current = records.get(financialDocumentId);
      assert.equal(expectedRevision, current.server.revision);
      const record = {
        server: { revision: current.server.revision + 1 },
        financialDocument: { ...current.financialDocument, ...patch },
      };
      records.set(financialDocumentId, record);
      return { ok: true, data: { record } };
    },
  };
  const commands = {
    async executeCreateFinancialDocumentCommand({ input, idempotencyKey }) {
      invoiceCreates += 1;
      assert.equal(idempotencyKey, `ixi-sales-order-invoice:${salesOrderId}`);
      const invoice = {
        financialDocumentId: "ifd_invoice_1",
        documentNumber: "INV-0001",
        documentType: "invoice",
        financialState: "draft",
        sourceFinancialDocumentId: salesOrderId,
        metadata: input.metadata,
      };
      records.set(invoice.financialDocumentId, { server: { revision: 1 }, financialDocument: invoice });
      return { ok: true, data: { record: records.get(invoice.financialDocumentId) } };
    },
  };

  const providerPath = require.resolve("../financial/IXIFinancialProviderService");
  const commandPath = require.resolve("../financial/IXIFinancialCommandEngine");
  const servicePath = require.resolve("./IXISalesSigningService");
  require.cache[providerPath] = { id: providerPath, filename: providerPath, loaded: true, exports: provider };
  require.cache[commandPath] = { id: commandPath, filename: commandPath, loaded: true, exports: commands };
  delete require.cache[servicePath];
  const service = require(servicePath);

  const created = await service.ensureInvoiceForSalesOrder(salesOrderId, {
    actorPassportId: "pass_actor",
    entityPassportId: "pass_entity",
  });
  assert.equal(created.invoice.financialDocumentId, "ifd_invoice_1");
  assert.equal(created.order.related.invoiceId, "ifd_invoice_1");
  assert.equal(invoiceCreates, 1);

  const replay = await service.ensureInvoiceForSalesOrder(salesOrderId, {
    actorPassportId: "pass_actor",
    entityPassportId: "pass_entity",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(invoiceCreates, 1);

  const signed = await service.completeExternalSignature(salesOrderId, {
    signerName: "Keith Clements",
    signerDate: "2026-02-04",
    receivedVia: "email",
    externalReference: "Signed PDF retained",
    attestation: true,
  }, {
    actorPassportId: "pass_actor",
    entityPassportId: "pass_entity",
    requestId: "req-1",
  });
  assert.equal(signed.order.status, "signed");
  assert.equal(signed.invoice.financialDocumentId, "ifd_invoice_1");
  assert.equal(invoiceCreates, 1);
  assert.equal(records.get(salesOrderId).financialDocument.salesOrder.signing.signatureType, "external-document-attestation");
});
