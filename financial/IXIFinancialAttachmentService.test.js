"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.IXI_FINANCIAL_EVIDENCE_SECRET = "test-financial-evidence-secret-at-least-32-characters";

const {
  normalizeInput,
  signFinancialAttachmentEvidence,
  verifyFinancialAttachmentEvidence,
  createFinancialAttachmentDownload,
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

test("private evidence downloads require document-bound proof before storage is read", async () => {
  let reads = 0;
  const dependencies = { head: async () => { reads++; return {}; } };
  await assert.rejects(createFinancialAttachmentDownload({ financialDocument: { financialDocumentId: "different", attachments: [attachment()] }, attachmentId: "ifa_test" }, dependencies), /Verified evidence is unavailable/);
  const forged = { ...attachment(), verification: "forged" };
  await assert.rejects(createFinancialAttachmentDownload({ financialDocument: { financialDocumentId: "ifd_invoice_1", attachments: [forged] }, attachmentId: "ifa_test" }, dependencies), /Verified evidence is unavailable/);
  assert.equal(reads, 0);
});

test("download links are bounded, attachment-only and rejected if stored bytes differ", async () => {
  const item = attachment(); item.verification = signFinancialAttachmentEvidence(item);
  const input = { financialDocument: { financialDocumentId: item.financialDocumentId, attachments: [item] }, attachmentId: item.attachmentId };
  const matchingHead = { ContentLength: item.sizeBytes, ContentType: item.mimeType, ChecksumSHA256: item.checksumSha256 };
  let signed;
  const result = await createFinancialAttachmentDownload(input, {
    head: async () => matchingHead,
    sign: async (command, options) => { signed = { command, options }; return "https://test.invalid/private-read"; }
  });
  assert.equal(result.expiresInSeconds, 60);
  assert.equal(signed.options.expiresIn, 60);
  assert.match(signed.command.input.ResponseContentDisposition, /^attachment;/);
  assert.equal(signed.command.input.Key, item.storageKey);
  assert.equal(signed.command.input.ResponseCacheControl, "private, no-store");
  await assert.rejects(createFinancialAttachmentDownload(input, { head: async () => ({ ...matchingHead, ChecksumSHA256: "changed" }), sign: () => assert.fail("tampered evidence cannot be signed") }), /does not match/);
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
