"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 30;
const PENDING_STALE_MS = 2 * 60 * 1000;

let database = null;
let databasePath = "";

function clean(value) {
  return String(value ?? "").trim();
}

function emailError(code, message, status = 500, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

function resolveDatabasePath() {
  return (
    clean(process.env.IXI_EMAIL_DB_PATH) ||
    path.join(process.cwd(), "data", "email", "passport-email.sqlite")
  );
}

function openDatabase() {
  const nextPath = resolveDatabasePath();

  if (database && databasePath === nextPath) {
    return database;
  }

  if (database) {
    database.close();
  }

  fs.mkdirSync(path.dirname(nextPath), { recursive: true });
  database = new Database(nextPath);
  databasePath = nextPath;
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS passport_email_deliveries (
      idempotency_key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      passport_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      recipients_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 1,
      provider_message_ids_json TEXT,
      failure_code TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS passport_email_deliveries_passport_idx
      ON passport_email_deliveries(passport_id, created_at_ms);

    CREATE TABLE IF NOT EXISTS passport_email_rate_buckets (
      principal_id TEXT NOT NULL,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (principal_id, window_start_ms)
    );
  `);

  try {
    fs.chmodSync(nextPath, 0o600);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }

  return database;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function consumePassportEmailRate({
  principalId,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now()
} = {}) {
  const principal = clean(principalId);
  if (!principal) {
    throw emailError(
      "IXI_PASSPORT_EMAIL_PRINCIPAL_REQUIRED",
      "Authenticated sender identity is required.",
      401
    );
  }

  const db = openDatabase();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = windowStart + windowMs;

  const count = db.transaction(() => {
    db.prepare(`
      DELETE FROM passport_email_rate_buckets
      WHERE window_start_ms < ?
    `).run(windowStart - windowMs);

    db.prepare(`
      INSERT INTO passport_email_rate_buckets (
        principal_id, window_start_ms, count, updated_at_ms
      ) VALUES (?, ?, 0, ?)
      ON CONFLICT(principal_id, window_start_ms) DO NOTHING
    `).run(principal, windowStart, now);

    const record = db.prepare(`
      SELECT count
      FROM passport_email_rate_buckets
      WHERE principal_id = ? AND window_start_ms = ?
    `).get(principal, windowStart);

    if (Number(record?.count || 0) >= limit) {
      return null;
    }

    db.prepare(`
      UPDATE passport_email_rate_buckets
      SET count = count + 1, updated_at_ms = ?
      WHERE principal_id = ? AND window_start_ms = ?
    `).run(now, principal, windowStart);

    return Number(record?.count || 0) + 1;
  })();

  if (count === null) {
    const error = emailError(
      "IXI_PASSPORT_EMAIL_RATE_LIMITED",
      "Too many Passport email requests. Wait before trying again.",
      429,
      true
    );
    error.retryAfterSeconds = Math.max(
      1,
      Math.ceil((expiresAt - now) / 1000)
    );
    throw error;
  }

  return { count, limit, windowStart, expiresAt };
}

function claimPassportEmailDelivery({
  idempotencyKey,
  fingerprint,
  passportId,
  listingId,
  principalId,
  recipients,
  allowPendingRetry = true,
  now = Date.now()
} = {}) {
  const key = clean(idempotencyKey);
  const db = openDatabase();

  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT *
      FROM passport_email_deliveries
      WHERE idempotency_key = ?
    `).get(key);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw emailError(
          "IXI_PASSPORT_EMAIL_IDEMPOTENCY_CONFLICT",
          "This send token was already used for different content.",
          409
        );
      }

      if (existing.status === "succeeded") {
        return {
          acquired: false,
          replayed: true,
          result: {
            recipientCount: parseJson(existing.recipients_json, []).length,
            messageIds: parseJson(
              existing.provider_message_ids_json,
              []
            )
          }
        };
      }

      if (
        existing.status === "pending" &&
        (!allowPendingRetry || now - Number(existing.updated_at_ms || 0) < PENDING_STALE_MS)
      ) {
        throw emailError(
          "IXI_PASSPORT_EMAIL_IN_PROGRESS",
          "This Passport email is already being delivered.",
          409,
          true
        );
      }

      db.prepare(`
        UPDATE passport_email_deliveries
        SET status = 'pending',
            attempt_count = attempt_count + 1,
            failure_code = NULL,
            updated_at_ms = ?
        WHERE idempotency_key = ?
      `).run(now, key);

      return { acquired: true, replayed: false };
    }

    db.prepare(`
      INSERT INTO passport_email_deliveries (
        idempotency_key,
        fingerprint,
        passport_id,
        listing_id,
        principal_id,
        recipients_json,
        status,
        attempt_count,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
    `).run(
      key,
      fingerprint,
      clean(passportId),
      clean(listingId),
      clean(principalId),
      JSON.stringify(recipients),
      now,
      now
    );

    return { acquired: true, replayed: false };
  })();
}

function completePassportEmailDelivery({
  idempotencyKey,
  messageIds,
  now = Date.now()
} = {}) {
  openDatabase().prepare(`
    UPDATE passport_email_deliveries
    SET status = 'succeeded',
        provider_message_ids_json = ?,
        failure_code = NULL,
        updated_at_ms = ?
    WHERE idempotency_key = ?
  `).run(
    JSON.stringify(Array.isArray(messageIds) ? messageIds : []),
    now,
    clean(idempotencyKey)
  );
}

function failPassportEmailDelivery({
  idempotencyKey,
  code,
  now = Date.now()
} = {}) {
  openDatabase().prepare(`
    UPDATE passport_email_deliveries
    SET status = 'failed',
        failure_code = ?,
        updated_at_ms = ?
    WHERE idempotency_key = ? AND status = 'pending'
  `).run(
    clean(code) || "IXI_PASSPORT_EMAIL_DELIVERY_FAILED",
    now,
    clean(idempotencyKey)
  );
}

function closePassportEmailStore() {
  if (database) {
    database.close();
  }
  database = null;
  databasePath = "";
}

function getPassportEmailDelivery(idempotencyKey) {
  return openDatabase().prepare("SELECT * FROM passport_email_deliveries WHERE idempotency_key = ?").get(clean(idempotencyKey)) || null;
}

module.exports = {
  DEFAULT_WINDOW_MS,
  DEFAULT_LIMIT,
  PENDING_STALE_MS,
  consumePassportEmailRate,
  claimPassportEmailDelivery,
  completePassportEmailDelivery,
  failPassportEmailDelivery,
  getPassportEmailDelivery,
  closePassportEmailStore
};
