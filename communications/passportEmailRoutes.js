"use strict";

const crypto = require("crypto");
const express = require("express");

const {
  findPassportById,
  passportSources
} = require("../passport/passportRegistry");
const {
  verifyInternalRequest
} = require("../mos/security/internalRequestAuthService");
const {
  sendPassportEmail
} = require("../identity/IXICommunicationsService");
const {
  consumePassportEmailRate,
  claimPassportEmailDelivery,
  completePassportEmailDelivery,
  failPassportEmailDelivery
} = require("./passportEmailStore");

const MAX_RECIPIENTS = 5;
const MAX_SUBJECT_LENGTH = 200;
const MAX_TEXT_LENGTH = 100000;
const MAX_HTML_LENGTH = 750000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function clean(value) {
  return String(value ?? "").trim();
}

function routeError(code, message, status = 400, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

function validateIdempotencyKey(value) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_-]{16,120}$/u.test(key)) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_IDEMPOTENCY_KEY_INVALID",
      "A valid send token is required."
    );
  }
  return key;
}

function validateRecipients(value) {
  const recipients = Array.from(
    new Set(
      (Array.isArray(value) ? value : [value])
        .flatMap(item => clean(item).split(/[;,\n]/u))
        .map(item => clean(item).toLowerCase())
        .filter(Boolean)
    )
  );

  if (
    recipients.length < 1 ||
    recipients.length > MAX_RECIPIENTS ||
    recipients.some(
      email => email.length > 254 || !EMAIL_PATTERN.test(email)
    )
  ) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_RECIPIENTS_INVALID",
      "Enter one to five valid recipient email addresses."
    );
  }

  return recipients;
}

function validateContent(body = {}) {
  const subject = clean(body.subject);
  const text = String(body.text ?? "");
  const html = String(body.html ?? "");

  if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_SUBJECT_INVALID",
      "Passport email subject is required and must be 200 characters or fewer."
    );
  }

  if (!text || text.length > MAX_TEXT_LENGTH) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_TEXT_INVALID",
      "Passport email text is required and exceeds the allowed size."
    );
  }

  if (!html || html.length > MAX_HTML_LENGTH) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_HTML_INVALID",
      "Passport email HTML is required and exceeds the allowed size."
    );
  }

  return { subject, text, html };
}

function assertPassportListing(passport, listingId) {
  const id = clean(listingId);
  if (!/^[A-Za-z0-9-]{8,80}$/u.test(id)) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_LISTING_INVALID",
      "A valid Marketplace listing is required."
    );
  }

  const sources = passportSources(passport);
  if (!sources.some(source => source.sourceId === id)) {
    throw routeError(
      "IXI_PASSPORT_EMAIL_LISTING_MISMATCH",
      "The Marketplace listing does not belong to this Passport.",
      409
    );
  }

  return id;
}

function fingerprintPayload(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function createPassportEmailHandler(dependencies = {}) {
  const verifyRequest =
    dependencies.verifyRequest || verifyInternalRequest;
  const findPassport =
    dependencies.findPassport || findPassportById;
  const sendEmail =
    dependencies.sendEmail || sendPassportEmail;
  const consumeRate =
    dependencies.consumeRate || consumePassportEmailRate;
  const claimDelivery =
    dependencies.claimDelivery || claimPassportEmailDelivery;
  const completeDelivery =
    dependencies.completeDelivery || completePassportEmailDelivery;
  const failDelivery =
    dependencies.failDelivery || failPassportEmailDelivery;

  return async function passportEmailHandler(req, res) {
    let idempotencyKey = "";
    let claimed = false;

    res.setHeader("Cache-Control", "no-store, private");

    try {
      const auth = verifyRequest(req);
      const passportId = clean(req.params?.passportId).toUpperCase();
      const passport = findPassport(passportId);

      if (!passport) {
        throw routeError(
          "IXI_PASSPORT_EMAIL_PASSPORT_NOT_FOUND",
          "IXI Machine Passport was not found.",
          404
        );
      }

      const listingId = assertPassportListing(
        passport,
        req.body?.listingId
      );
      const recipients = validateRecipients(req.body?.recipients);
      const content = validateContent(req.body);
      idempotencyKey = validateIdempotencyKey(
        req.headers["idempotency-key"] ||
        req.body?.idempotencyKey
      );
      const principalId = clean(auth?.principalId);

      if (!principalId) {
        throw routeError(
          "IXI_PASSPORT_EMAIL_PRINCIPAL_REQUIRED",
          "Authenticated sender identity is required.",
          401
        );
      }

      const fingerprint = fingerprintPayload({
        passportId,
        listingId,
        recipients,
        ...content
      });

      consumeRate({ principalId });
      const claim = claimDelivery({
        idempotencyKey,
        fingerprint,
        passportId,
        listingId,
        principalId,
        recipients
      });

      if (claim.replayed) {
        return res.status(200).json({
          ok: true,
          delivery: {
            passportId,
            listingId,
            recipientCount: claim.result.recipientCount,
            replayed: true
          }
        });
      }

      claimed = true;
      const deliveries = [];

      for (const recipient of recipients) {
        deliveries.push(
          await sendEmail({
            to: recipient,
            subject: content.subject,
            text: content.text,
            html: content.html,
            passportId,
            listingId,
            principalId
          })
        );
      }

      const messageIds = deliveries
        .map(delivery => clean(delivery?.messageId))
        .filter(Boolean);

      completeDelivery({ idempotencyKey, messageIds });

      console.info({
        event: "ixi_passport_email_delivered",
        passportId,
        listingId,
        principalId,
        recipientCount: recipients.length,
        provider: "amazon-ses"
      });

      return res.status(200).json({
        ok: true,
        delivery: {
          passportId,
          listingId,
          recipientCount: recipients.length,
          replayed: false
        }
      });
    } catch (error) {
      if (claimed && idempotencyKey) {
        failDelivery({
          idempotencyKey,
          code: error?.code
        });
      }

      const status = Number(error?.statusCode || error?.status || 500);
      if (error?.retryAfterSeconds) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
      }

      console.error({
        event: "ixi_passport_email_failed",
        code: error?.code || "IXI_PASSPORT_EMAIL_DELIVERY_FAILED",
        status,
        retryable: Boolean(error?.retryable)
      });

      return res.status(status >= 400 && status <= 599 ? status : 500).json({
        ok: false,
        error: {
          code:
            error?.code ||
            "IXI_PASSPORT_EMAIL_DELIVERY_FAILED",
          message:
            status >= 500
              ? "IXI Machine Passport email could not be delivered."
              : error?.message || "Passport email request was rejected.",
          retryable: Boolean(error?.retryable)
        }
      });
    }
  };
}

const passportEmailRouter = express.Router();
passportEmailRouter.post(
  "/passports/:passportId/email",
  createPassportEmailHandler()
);

module.exports = {
  MAX_RECIPIENTS,
  validateRecipients,
  validateContent,
  validateIdempotencyKey,
  assertPassportListing,
  fingerprintPayload,
  createPassportEmailHandler,
  passportEmailRouter
};
