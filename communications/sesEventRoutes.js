"use strict";

const crypto = require("node:crypto");
const express = require("express");

const {
  recordCommunicationProviderEvent
} = require("./passportEmailStore");

const certificateCache = new Map();

function clean(value) { return String(value ?? "").trim(); }

function parseSnsBody(body) {
  if (typeof body !== "string") return body || {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Amazon SNS message body is invalid JSON."), { status: 400 });
  }
}

function assertSnsUrl(value, kind) {
  const url = new URL(clean(value));
  const hostAllowed = /^sns(?:\.[a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/u.test(url.hostname);
  if (url.protocol !== "https:" || !hostAllowed) {
    const error = new Error(`Amazon SNS ${kind} URL is invalid.`);
    error.status = 400;
    throw error;
  }
  if (kind === "certificate" && !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/u.test(url.pathname)) {
    const error = new Error("Amazon SNS certificate path is invalid.");
    error.status = 400;
    throw error;
  }
  return url;
}

function canonicalSnsMessage(message) {
  const fields = message.Type === "Notification"
    ? ["Message", "MessageId", ...(message.Subject ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return fields.map(field => `${field}\n${clean(message[field])}\n`).join("");
}

async function loadCertificate(url, fetchImpl = fetch) {
  const key = url.toString();
  const cached = certificateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;
  const response = await fetchImpl(key, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Object.assign(new Error("Amazon SNS certificate could not be loaded."), { status: 502 });
  const pem = await response.text();
  const certificate = new crypto.X509Certificate(pem);
  if (certificate.validTo && Date.parse(certificate.validTo) <= Date.now()) {
    throw Object.assign(new Error("Amazon SNS certificate is expired."), { status: 401 });
  }
  certificateCache.set(key, { pem, expiresAt: Date.now() + 60 * 60 * 1000 });
  return pem;
}

async function verifySnsMessage(message, dependencies = {}) {
  const expectedTopicArn = clean(process.env.IXI_SES_EVENT_TOPIC_ARN);
  if (!expectedTopicArn) throw Object.assign(new Error("SES event topic is not configured."), { status: 503 });
  if (clean(message?.TopicArn) !== expectedTopicArn) throw Object.assign(new Error("Amazon SNS topic is not authorized."), { status: 403 });
  if (!["Notification", "SubscriptionConfirmation"].includes(message?.Type)) throw Object.assign(new Error("Amazon SNS message type is not supported."), { status: 400 });
  if (!["1", "2"].includes(clean(message.SignatureVersion))) throw Object.assign(new Error("Amazon SNS signature version is invalid."), { status: 400 });
  const certificateUrl = assertSnsUrl(message.SigningCertURL, "certificate");
  const pem = await loadCertificate(certificateUrl, dependencies.fetchImpl);
  const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const valid = crypto.verify(
    algorithm,
    Buffer.from(canonicalSnsMessage(message), "utf8"),
    pem,
    Buffer.from(clean(message.Signature), "base64")
  );
  if (!valid) throw Object.assign(new Error("Amazon SNS signature is invalid."), { status: 401 });
  return true;
}

function eventTimestamp(payload = {}) {
  const section = payload.delivery || payload.bounce || payload.complaint || payload.reject || payload.deliveryDelay || payload.renderingFailure || {};
  const value = Date.parse(section.timestamp || payload.mail?.timestamp || "");
  return Number.isFinite(value) ? value : Date.now();
}

function createSesEventHandler(dependencies = {}) {
  const verify = dependencies.verify || verifySnsMessage;
  const record = dependencies.record || recordCommunicationProviderEvent;
  const fetchImpl = dependencies.fetchImpl || fetch;
  return async function sesEventHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    try {
      const message = parseSnsBody(req.body);
      await verify(message, { fetchImpl });
      if (message.Type === "SubscriptionConfirmation") {
        const subscribeUrl = assertSnsUrl(message.SubscribeURL, "subscription");
        const response = await fetchImpl(subscribeUrl.toString(), { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw Object.assign(new Error("Amazon SNS subscription confirmation failed."), { status: 502 });
        return res.status(200).json({ ok: true, subscriptionConfirmed: true });
      }
      const payload = JSON.parse(clean(message.Message));
      const eventType = clean(payload.eventType || payload.notificationType);
      const providerMessageId = clean(payload.mail?.messageId);
      if (!eventType || !providerMessageId) throw Object.assign(new Error("SES event payload is incomplete."), { status: 400 });
      const result = record({
        eventId: clean(message.MessageId),
        providerMessageId,
        eventType,
        eventAtMs: eventTimestamp(payload),
        payloadHash: crypto.createHash("sha256").update(clean(message.Message)).digest("hex")
      });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      const status = Number(error?.status || 500);
      console.error({ event: "ixi_ses_event_rejected", status, code: error?.code || "IXI_SES_EVENT_REJECTED" });
      return res.status(status >= 400 && status <= 599 ? status : 500).json({
        ok: false,
        error: status >= 500 ? "SES delivery event could not be processed." : error.message
      });
    }
  };
}

const sesEventRouter = express.Router();
sesEventRouter.post(
  "/provider-events/ses",
  express.text({ type: "text/plain", limit: "256kb" }),
  createSesEventHandler()
);

module.exports = {
  assertSnsUrl,
  parseSnsBody,
  canonicalSnsMessage,
  verifySnsMessage,
  createSesEventHandler,
  sesEventRouter
};
