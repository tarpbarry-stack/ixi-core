"use strict";

const crypto = require("crypto");

function clean(value) {
  return String(value ?? "").trim();
}

function safeObject(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {};
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round(number(value) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function createFreightId() {
  const day = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  const suffix = crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `FO-${day}-${suffix}`;
}

function hashPayload(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value || {}))
    .digest("hex");
}

module.exports = {
  clean,
  safeObject,
  number,
  money,
  nowIso,
  createFreightId,
  hashPayload
};
