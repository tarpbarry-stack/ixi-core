"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.IXI_FINANCIAL_EVIDENCE_SECRET = "test-financial-evidence-secret-at-least-32-characters";

const {
  normalizeInput,
  signFinancialAttachmentEvidence,
  verifyFinancialAttachmentEvidence,
} = require("./IXIFinancialAttachmentService");

const attachment = () => ({
  attachmentId: "ifa_test",
  financialDocumentId: "ifd_invoice_1",
  type: "bill-of-sale",
  fileName: "bill-of-sale.pdf",
  mimeType: "application/pdf",
  size: 128,
  sizeBytes: 128,
  checksumSha256: Buffer.alloc(32, 7).toString("base64"),
  storageKey: "financial-evidence/entity-1/ifd_invoice_1/ifa_test.pdf",
  status: "verified",
});

test("financial evidence input is allowlisted and bounded", () => {
  const valid = normalizeInput({
    financialDocumentId: "ifd_invoice_1",
    entityPassportId: "entity-1",
    fileName: "bill.pdf",
    contentType: "application/pdf",
    sizeBytes: 128,
    checksumSha256: Buffer.alloc(32, 7).toString("base64"),
  });
  assert.equal(valid.contentType, "application/pdf");
  assert.throws(() => normalizeInput({ ...valid, contentType: "text/html" }), /PDF, JPEG, PNG, or WebP/u);
  assert.throws(() => normalizeInput({ ...valid, sizeBytes: 11 * 1024 * 1024 }), /10MB/u);
});

test("financial evidence proof is document-bound and tamper evident", () => {
  const source = attachment();
  source.verification = signFinancialAttachmentEvidence(source);
  assert.equal(verifyFinancialAttachmentEvidence(source, { financialDocumentId: "ifd_invoice_1" }), true);
  assert.equal(verifyFinancialAttachmentEvidence({ ...source, sizeBytes: 129 }, { financialDocumentId: "ifd_invoice_1" }), false);
  assert.equal(verifyFinancialAttachmentEvidence(source, { financialDocumentId: "ifd_invoice_2" }), false);
});
