"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.IXI_FINANCIAL_EVIDENCE_SECRET = "test-financial-evidence-secret-at-least-32-characters";

const providerService = require("./IXIFinancialProviderService");
const { signFinancialAttachmentEvidence } = require("./IXIFinancialAttachmentService");
const {
  getInvoiceCollectionPosition,
  assertInvoiceCollectionPatchAvailable,
  assertCollectedAssetSaleInvoice,
} = require("./IXIFinancialSalesCloseoutControl");

const invoice = overrides => ({
  financialDocumentId: "ifd_invoice001",
  documentType: "invoice",
  documentNumber: "INV-1001",
  financialState: "billed",
  totals: { total: 100 },
  metadata: { invoiceType: "asset-sale" },
  ...overrides,
});

const payment = (amount, overrides = {}) => ({
  financialDocument: {
    financialDocumentId: `ifd_payment_${amount}`,
    documentType: "payment",
    financialState: "paid",
    paymentDirection: "inflow",
    sourceFinancialDocumentId: "ifd_invoice001",
    totals: { total: amount },
    ...overrides,
  },
});

const billOfSale = () => {
  const attachment = {
    attachmentId: "ifa_bill_of_sale",
    financialDocumentId: "ifd_invoice001",
    type: "bill-of-sale",
    fileName: "bill-of-sale.pdf",
    mimeType: "application/pdf",
    size: 256,
    sizeBytes: 256,
    checksumSha256: Buffer.alloc(32, 9).toString("base64"),
    storageKey: "financial-evidence/IXI-ENTITY/ifd_invoice001/ifa_bill_of_sale.pdf",
    status: "verified",
  };
  return { ...attachment, verification: signFinancialAttachmentEvidence(attachment) };
};

async function withDocuments(documents, operation) {
  const original = providerService.listDocumentsByPassport;
  providerService.listDocumentsByPassport = async () => ({
    ok: true,
    data: { documents },
  });
  try {
    return await operation();
  } finally {
    providerService.listDocumentsByPassport = original;
  }
}

test("invoice collection position counts only active canonical receipts and credits", async () => {
  await withDocuments(
    [
      payment(40),
      payment(60, { financialState: "void" }),
      payment(10, { financialState: "draft" }),
      {
        financialDocument: {
          financialDocumentId: "ifd_credit_1",
          documentType: "credit",
          financialState: "incurred",
          sourceFinancialDocumentId: "ifd_invoice001",
          totals: { total: 10 },
        },
      },
    ],
    async () => {
      const position = await getInvoiceCollectionPosition({
        invoice: invoice(),
        entityPassportId: "IXI-ENTITY",
      });
      assert.equal(position.received, 40);
      assert.equal(position.credited, 10);
      assert.equal(position.balance, 50);
      assert.equal(position.expectedFinancialState, "partially-collected");
    },
  );
});

test("invoice collection state must equal the canonical linked-document position", async () => {
  await withDocuments([payment(40)], async () => {
    await assert.rejects(
      () => assertInvoiceCollectionPatchAvailable({
        existing: invoice(),
        merged: invoice({ financialState: "collected" }),
        entityPassportId: "IXI-ENTITY",
      }),
      /must be partially-collected/u,
    );
    const result = await assertInvoiceCollectionPatchAvailable({
      existing: invoice(),
      merged: invoice({ financialState: "partially-collected" }),
      entityPassportId: "IXI-ENTITY",
    });
    assert.equal(result.balance, 60);
  });
});

test("SOLD requires a canonical zero-balance Invoice and matching lineage", async () => {
  await withDocuments([payment(100)], async () => {
    const soldRecord = {
      identity: {
        saleId: "ifd_invoice001",
        financialInvoiceId: "ifd_invoice001",
      },
      sale: { billOfSaleNumber: "BOS-1001" },
      status: "sold",
    };
    const result = await assertInvoiceCollectionPatchAvailable({
      existing: invoice(),
      merged: invoice({
        financialState: "collected",
        attachments: [billOfSale()],
        metadata: { assetSale: true, transactModule: "sold", assetSaleRecord: soldRecord },
      }),
      entityPassportId: "IXI-ENTITY",
    });
    assert.equal(result.balance, 0);
  });
});

test("SOLD rejects fabricated or missing Bill of Sale evidence", async () => {
  await withDocuments([payment(100)], async () => {
    const soldRecord = {
      identity: { saleId: "ifd_invoice001", financialInvoiceId: "ifd_invoice001" },
      sale: { billOfSaleNumber: "BOS-1001" },
      status: "sold",
    };
    await assert.rejects(() => assertInvoiceCollectionPatchAvailable({
      existing: invoice(),
      merged: invoice({
        financialState: "collected",
        attachments: [{ ...billOfSale(), verification: "fabricated" }],
        metadata: { assetSale: true, transactModule: "sold", assetSaleRecord: soldRecord },
      }),
      entityPassportId: "IXI-ENTITY",
    }), /server-verified Bill of Sale/u);
  });
});

test("Settlement requires the completed SOLD closeout and full collection", async () => {
  await withDocuments([payment(100)], async () => {
    await assert.rejects(
      () => assertCollectedAssetSaleInvoice({
        invoice: invoice({ financialState: "collected" }),
        entityPassportId: "IXI-ENTITY",
      }),
      /completed SOLD closeout/u,
    );
    const result = await assertCollectedAssetSaleInvoice({
      invoice: invoice({
        financialState: "collected",
        metadata: { assetSale: true, assetSaleRecord: { status: "sold" } },
      }),
      entityPassportId: "IXI-ENTITY",
    });
    assert.equal(result.balance, 0);
  });
});
