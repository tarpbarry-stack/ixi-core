"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createFinancialDocumentByType } = require("../financial/IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("../financial/IXIFinancialValidationBridge");

for (const receivedVia of ["paper", "email", "other"]) {
test(`external ${receivedVia} signature passes persistence validation and reuses the collected Invoice`, async () => {
  const records = new Map();
  let invoiceCreates = 0;
  const salesOrderId = "ifd_sales_order_1";
  records.set(salesOrderId, {
    server: { revision: 1 },
    financialDocument: createFinancialDocumentByType({ documentType: "sales-order", input: {
      financialDocumentId: salesOrderId,
      documentType: "sales-order",
      references: [{ passportId: "pass_machine", role: "asset" }, { passportId: "pass_entity", role: "entity" }, { passportId: "pass_actor", role: "employee" }],
      accountingTreatment: { invoiceGenerated: false },
      salesOrder: {
        schema: "ixi-equipment-sales-order-v1",
        identity: { salesOrderId, financialDocumentId: salesOrderId, number: "SO-1001", revision: 1 },
        context: { primaryPassportId: "pass_machine", entityPassportId: "pass_entity", actorPassportId: "pass_actor" },
        customer: { name: "Example Equipment Buyer" },
        asset: { passportId: "pass_machine", label: "Example machine", serialNumber: "" },
        commercial: { currency: "USD", paymentTerms: "Wire before release" },
        totals: { subtotal: 82000, total: 82000, balanceDue: 82000 },
        termsDocument: {},
        signing: {}, related: {}, activity: [], audit: {}, status: "draft",
      },
    } }),
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
      const validation = validateFinancialDocument(record.financialDocument);
      assert.equal(validation.ok, true, validation.errors.join("\n"));
      records.set(financialDocumentId, record);
      return { ok: true, data: { record } };
    },
  };
  const commands = {
    async executeCreateFinancialDocumentCommand({ input, idempotencyKey }) {
      invoiceCreates += 1;
      assert.equal(idempotencyKey, `ixi-sales-order-invoice:${salesOrderId}`);
      const invoice = createFinancialDocumentByType({ documentType: "invoice", input: {
        ...input, financialDocumentId: "ifd_invoice_1",
      } });
      const validation = validateFinancialDocument(invoice);
      assert.equal(validation.ok, true, validation.errors.join("\n"));
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
  assert.match(created.invoice.documentNumber, /^INV-[A-F0-9]{12}$/);
  assert.equal(created.order.related.invoiceNumber, created.invoice.documentNumber);
  assert.equal(created.invoice.totals.total, 82000);
  assert.equal(created.invoice.sourceFinancialDocumentId, salesOrderId);
  assert.equal(service.invoiceInput(created.order, salesOrderId).documentNumber, created.invoice.documentNumber);

  // Existing/imported invoices can already be collected without a commercial
  // number. Recording external paperwork must leave their accounting intact.
  const invoiceRecord = records.get("ifd_invoice_1");
  invoiceRecord.financialDocument.documentNumber = "";
  invoiceRecord.financialDocument.financialState = "collected";
  invoiceRecord.financialDocument.metadata.amountReceived = 82000;
  invoiceRecord.financialDocument.metadata.balanceDue = 0;
  const preservedInvoice = structuredClone(invoiceRecord);

  const replay = await service.ensureInvoiceForSalesOrder(salesOrderId, {
    actorPassportId: "pass_actor",
    entityPassportId: "pass_entity",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(invoiceCreates, 1);

  const signed = await service.completeExternalSignature(salesOrderId, {
    signerName: "Keith Clements",
    signerDate: "2026-02-04",
    receivedVia,
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
  const saved = records.get(salesOrderId).financialDocument;
  assert.equal(saved.salesOrder.signing.signatureType, "external-document-attestation");
  assert.equal(saved.salesOrder.signing.receivedVia, receivedVia);
  assert.equal(saved.salesOrder.signing.attestedByPassportId, "pass_actor");
  assert.match(saved.salesOrder.signing.signedPackageHash, /^[a-f0-9]{64}$/);
  assert.equal(saved.accountingTreatment.createsReceivable, false);
  assert.equal(saved.accountingTreatment.createsCashEvent, false);
  assert.deepEqual(records.get("ifd_invoice_1"), preservedInvoice);
  const signedReplay = await service.completeExternalSignature(salesOrderId, {}, {
    actorPassportId: "pass_actor", entityPassportId: "pass_entity",
  });
  assert.equal(signedReplay.idempotentReplay, true);
  assert.equal(invoiceCreates, 1);
  assert.equal(records.size, 2);
  assert.deepEqual(records.get("ifd_invoice_1"), preservedInvoice);
});

}
