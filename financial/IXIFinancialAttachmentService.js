"use strict";

const crypto = require("crypto");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { REGION, BUCKET } = require("../media/config/mediaConfig");

const s3 = new S3Client({ region: REGION });
const MAX_FINANCIAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PRESIGNED_UPLOAD_SECONDS = 15 * 60;
const ALLOWED_CONTENT_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const clean = value => String(value ?? "").trim();
const safeSegment = value => clean(value)
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120);

function evidenceSecret() {
  const secret = clean(process.env.IXI_FINANCIAL_EVIDENCE_SECRET || process.env.IXI_MOS_INTERNAL_SECRET);
  if (secret.length < 32) {
    throw Object.assign(new Error("Financial evidence signing is not configured."), {
      name: "IXIFinancialEvidenceConfigurationError",
    });
  }
  return secret;
}

function normalizeInput({ financialDocumentId, entityPassportId, fileName, contentType, sizeBytes, checksumSha256 } = {}) {
  const normalizedType = clean(contentType).split(";")[0].toLowerCase();
  const normalizedSize = Number(sizeBytes);
  const checksum = clean(checksumSha256);
  if (!clean(financialDocumentId) || !clean(entityPassportId)) throw new Error("Financial document and Entity are required for evidence upload.");
  if (!clean(fileName)) throw new Error("Evidence file name is required.");
  if (!ALLOWED_CONTENT_TYPES.has(normalizedType)) throw new Error("Evidence must be a PDF, JPEG, PNG, or WebP file.");
  if (!Number.isInteger(normalizedSize) || normalizedSize <= 0 || normalizedSize > MAX_FINANCIAL_ATTACHMENT_BYTES) throw new Error("Evidence file must be between 1 byte and 10MB.");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(checksum)) throw new Error("A valid SHA-256 file checksum is required.");
  return {
    financialDocumentId: clean(financialDocumentId),
    entityPassportId: clean(entityPassportId),
    fileName: path.basename(clean(fileName)).slice(0, 180),
    contentType: normalizedType,
    sizeBytes: normalizedSize,
    checksumSha256: checksum,
  };
}

function evidencePayload(attachment = {}) {
  return [
    clean(attachment.financialDocumentId),
    clean(attachment.storageKey),
    clean(attachment.checksumSha256),
    String(Number(attachment.sizeBytes || attachment.size || 0)),
    clean(attachment.mimeType || attachment.contentType).toLowerCase(),
  ].join("\n");
}

function signFinancialAttachmentEvidence(attachment = {}) {
  return crypto.createHmac("sha256", evidenceSecret()).update(evidencePayload(attachment)).digest("base64url");
}

function verifyFinancialAttachmentEvidence(attachment = {}, { financialDocumentId = "" } = {}) {
  if (!["uploaded", "available", "verified"].includes(clean(attachment.status).toLowerCase())) return false;
  if (!clean(attachment.storageKey) || !clean(attachment.checksumSha256) || !clean(attachment.verification)) return false;
  if (clean(financialDocumentId) && clean(attachment.financialDocumentId) !== clean(financialDocumentId)) return false;
  const expected = signFinancialAttachmentEvidence(attachment);
  const supplied = clean(attachment.verification);
  if (expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

async function createFinancialAttachmentUpload(input = {}) {
  const normalized = normalizeInput(input);
  const attachmentId = `ifa_${crypto.randomBytes(12).toString("hex")}`;
  const extension = ALLOWED_CONTENT_TYPES.get(normalized.contentType);
  const storageKey = [
    "financial-evidence",
    safeSegment(normalized.entityPassportId),
    safeSegment(normalized.financialDocumentId),
    `${attachmentId}.${extension}`,
  ].join("/");
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: normalized.contentType,
    ChecksumSHA256: normalized.checksumSha256,
    Metadata: {
      attachmentid: attachmentId,
      financialdocumentid: safeSegment(normalized.financialDocumentId),
      entitypassportid: safeSegment(normalized.entityPassportId),
      originalfilename: safeSegment(normalized.fileName),
    },
  }), { expiresIn: PRESIGNED_UPLOAD_SECONDS });
  return {
    attachmentId,
    storageKey,
    bucket: BUCKET,
    uploadUrl,
    expiresInSeconds: PRESIGNED_UPLOAD_SECONDS,
    ...normalized,
  };
}

async function completeFinancialAttachmentUpload(input = {}) {
  const normalized = normalizeInput(input);
  const storageKey = clean(input.storageKey);
  const attachmentId = clean(input.attachmentId);
  const expectedPrefix = `financial-evidence/${safeSegment(normalized.entityPassportId)}/${safeSegment(normalized.financialDocumentId)}/`;
  if (!attachmentId || !storageKey.startsWith(expectedPrefix) || !storageKey.includes(attachmentId)) throw new Error("Evidence upload identity is invalid.");
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: storageKey, ChecksumMode: "ENABLED" }));
  const actualType = clean(head.ContentType).split(";")[0].toLowerCase();
  const actualSize = Number(head.ContentLength || 0);
  const actualChecksum = clean(head.ChecksumSHA256);
  const metadata = head.Metadata || {};
  if (actualType !== normalized.contentType || actualSize !== normalized.sizeBytes || actualChecksum !== normalized.checksumSha256) throw new Error("Uploaded evidence did not match its signed file controls.");
  if (clean(metadata.attachmentid) !== attachmentId || clean(metadata.financialdocumentid) !== safeSegment(normalized.financialDocumentId) || clean(metadata.entitypassportid) !== safeSegment(normalized.entityPassportId)) throw new Error("Uploaded evidence ownership metadata is invalid.");
  const attachment = {
    attachmentId,
    financialDocumentId: normalized.financialDocumentId,
    type: clean(input.type || "attachment"),
    fileName: normalized.fileName,
    mimeType: normalized.contentType,
    size: normalized.sizeBytes,
    sizeBytes: normalized.sizeBytes,
    checksumAlgorithm: "SHA-256",
    checksumSha256: normalized.checksumSha256,
    storageKey,
    status: "verified",
    verifiedAt: new Date().toISOString(),
  };
  return { ...attachment, verification: signFinancialAttachmentEvidence(attachment) };
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  MAX_FINANCIAL_ATTACHMENT_BYTES,
  normalizeInput,
  evidencePayload,
  signFinancialAttachmentEvidence,
  verifyFinancialAttachmentEvidence,
  createFinancialAttachmentUpload,
  completeFinancialAttachmentUpload,
};
