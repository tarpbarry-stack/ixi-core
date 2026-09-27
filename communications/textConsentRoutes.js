"use strict";

const crypto = require("crypto");
const express = require("express");
const { verifyInternalRequest } = require("../mos/security/internalRequestAuthService");
const { recordTextMessagingConsent } = require("./passportEmailStore");

const PURPOSE = "requested-machine-passport-and-service-communications";
const POLICY_VERSION = "sales-inc-ironxchange-sms-2026-09-27";
const CONSENT_TEXT = "I agree to receive SMS text messages from Sales Inc., operating IronXchange, concerning machine inquiries, requested Machine Passports, transaction updates, and service communications. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase.";

function clean(value) { return String(value ?? "").trim(); }
function fail(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function mobile(value) {
  const digits = clean(value).replace(/\D/gu, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function createTextConsentHandler(dependencies = {}) {
  const verifyRequest = dependencies.verifyRequest || verifyInternalRequest;
  const recordConsent = dependencies.recordConsent || recordTextMessagingConsent;
  return function textConsentHandler(req, res) {
    res.setHeader("Cache-Control", "no-store, private");
    try {
      verifyRequest(req);
      const fullName = clean(req.body?.fullName).replace(/\s+/gu, " ");
      const mobileE164 = mobile(req.body?.mobileNumber);
      const accepted = req.body?.accepted === true;
      const idempotencyKey = clean(req.headers["idempotency-key"] || req.body?.idempotencyKey);
      if (fullName.length < 2 || fullName.length > 120) throw fail("IXI_TEXT_CONSENT_NAME_INVALID", "Enter your full name.");
      if (!mobileE164) throw fail("IXI_TEXT_CONSENT_MOBILE_INVALID", "Enter a valid U.S. mobile number.");
      if (!accepted) throw fail("IXI_TEXT_CONSENT_REQUIRED", "SMS consent must be explicitly selected.");
      if (!/^[A-Za-z0-9_-]{16,120}$/u.test(idempotencyKey)) throw fail("IXI_TEXT_CONSENT_TOKEN_INVALID", "A valid consent token is required.");
      if (clean(req.body?.policyVersion) !== POLICY_VERSION) throw fail("IXI_TEXT_CONSENT_POLICY_INVALID", "The SMS consent disclosure changed. Review and submit it again.", 409);

      const consentText = clean(req.body?.consentText);
      if (consentText !== CONSENT_TEXT) throw fail("IXI_TEXT_CONSENT_DISCLOSURE_INVALID", "The SMS consent disclosure changed. Review and submit it again.", 409);
      const payload = { fullName, mobileE164, purpose: PURPOSE, policyVersion: POLICY_VERSION, consentText };
      const result = recordConsent({
        consentId: `IXICONSENT-${crypto.randomUUID()}`,
        idempotencyKey,
        fingerprint: hash(JSON.stringify(payload)),
        ...payload,
        sourceUrl: clean(req.body?.sourceUrl).slice(0, 500),
        sourceIpHash: clean(req.body?.sourceIpHash),
        userAgentHash: clean(req.body?.userAgentHash)
      });
      return res.status(201).json({ ok: true, consent: result });
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 500);
      return res.status(status >= 400 && status <= 599 ? status : 500).json({
        ok: false,
        error: { code: error?.code || "IXI_TEXT_CONSENT_FAILED", message: status >= 500 ? "SMS consent could not be recorded." : error.message }
      });
    }
  };
}

const textConsentRouter = express.Router();
textConsentRouter.post("/text-consents", createTextConsentHandler());

module.exports = { PURPOSE, POLICY_VERSION, CONSENT_TEXT, mobile, createTextConsentHandler, textConsentRouter };
