"use strict";

const crypto = require("crypto");

const PURPOSE = "ixi-equipment-sales-order-signature-v1";
const clean = value => String(value ?? "").trim();
const base64url = value => Buffer.from(value).toString("base64url");
const unbase64url = value => Buffer.from(value, "base64url").toString("utf8");

function signingSecret() {
  const dedicated = clean(process.env.IXI_SALES_SIGNING_SECRET);
  if (dedicated.length >= 32) return dedicated;
  const internalMaster = clean(process.env.IXI_MOS_INTERNAL_SECRET);
  if (internalMaster.length < 32) {
    const error = new Error("IXI sales signing secret is not configured.");
    error.name = "IXISalesSigningConfigurationError";
    throw error;
  }
  return crypto.createHmac("sha256", internalMaster).update("ixi-sales-signing-v1").digest();
}

function signature(payload) {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function createSalesSigningToken({ salesOrderId, revision, tokenVersion, expiresAt, nonce = "" } = {}) {
  const id = clean(salesOrderId);
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (!id || !Number.isInteger(Number(revision)) || Number(revision) < 1 || !Number.isInteger(Number(tokenVersion)) || Number(tokenVersion) < 1 || !Number.isFinite(exp)) {
    throw new Error("A canonical Sales Order, revision, token version, and expiration are required.");
  }
  const claims = {
    purpose: PURPOSE,
    salesOrderId: id,
    revision: Number(revision),
    tokenVersion: Number(tokenVersion),
    exp,
    nonce: clean(nonce) || crypto.randomBytes(16).toString("hex")
  };
  const payload = base64url(JSON.stringify(claims));
  return `${payload}.${signature(payload)}`;
}

function verifySalesSigningToken(token, { now = Date.now() } = {}) {
  const [payload, supplied, extra] = clean(token).split(".");
  if (!payload || !supplied || extra) throw Object.assign(new Error("Signing link is invalid."), { name: "IXISalesSigningTokenError" });
  const expected = signature(payload);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw Object.assign(new Error("Signing link is invalid."), { name: "IXISalesSigningTokenError" });
  let claims;
  try { claims = JSON.parse(unbase64url(payload)); } catch { throw Object.assign(new Error("Signing link is invalid."), { name: "IXISalesSigningTokenError" }); }
  if (claims?.purpose !== PURPOSE || !clean(claims.salesOrderId) || !Number.isInteger(Number(claims.revision)) || !Number.isInteger(Number(claims.tokenVersion))) throw Object.assign(new Error("Signing link is invalid."), { name: "IXISalesSigningTokenError" });
  if (Number(claims.exp) * 1000 < Number(now)) throw Object.assign(new Error("Signing link has expired."), { name: "IXISalesSigningTokenExpiredError" });
  return claims;
}

module.exports = { PURPOSE, createSalesSigningToken, verifySalesSigningToken };
