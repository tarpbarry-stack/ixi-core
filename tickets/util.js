"use strict";

const crypto = require("crypto");

function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${clean(prefix) || "id"}_${crypto.randomUUID()}`;
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      safeArray(values)
        .map(clean)
        .filter(Boolean)
    )
  ];
}

function deepClone(value) {
  return JSON.parse(
    JSON.stringify(value ?? null)
  );
}

module.exports = {
  clean,
  lower,
  safeObject,
  safeArray,
  nowIso,
  createId,
  uniqueStrings,
  deepClone
};
