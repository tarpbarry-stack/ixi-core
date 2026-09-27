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

    CREATE TABLE IF NOT EXISTS text_messaging_consents (
      consent_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      fingerprint TEXT NOT NULL,
      full_name TEXT NOT NULL,
      mobile_e164 TEXT NOT NULL,
      purpose TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      consent_text TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_ip_hash TEXT NOT NULL,
      user_agent_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS text_messaging_consents_mobile_idx
      ON text_messaging_consents(mobile_e164, created_at_ms);

    CREATE TABLE IF NOT EXISTS communication_passport_links (
      idempotency_key TEXT NOT NULL,
      passport_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (idempotency_key, passport_id),
      FOREIGN KEY (idempotency_key)
        REFERENCES passport_email_deliveries(idempotency_key)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS communication_passport_links_passport_idx
      ON communication_passport_links(passport_id, created_at_ms DESC);

    CREATE TABLE IF NOT EXISTS communication_provider_messages (
      provider_message_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      recipient TEXT,
      status TEXT NOT NULL,
      last_event_type TEXT,
      last_event_at_ms INTEGER,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (idempotency_key)
        REFERENCES passport_email_deliveries(idempotency_key)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS communication_provider_messages_delivery_idx
      ON communication_provider_messages(idempotency_key);

    CREATE TABLE IF NOT EXISTS communication_provider_events (
      event_id TEXT PRIMARY KEY,
      provider_message_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_at_ms INTEGER NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `);

  const columns = new Set(
    database.prepare("PRAGMA table_info(passport_email_deliveries)")
      .all()
      .map(column => column.name)
  );
  const migrations = [
    ["communication_kind", "TEXT NOT NULL DEFAULT 'passport'"],
    ["subject", "TEXT"],
    ["provider", "TEXT NOT NULL DEFAULT 'amazon-ses'"],
    ["provider_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["accepted_at_ms", "INTEGER"],
    ["delivered_at_ms", "INTEGER"],
    ["last_event_at_ms", "INTEGER"]
  ];
  for (const [name, definition] of migrations) {
    if (!columns.has(name)) {
      database.exec(
        `ALTER TABLE passport_email_deliveries ADD COLUMN ${name} ${definition}`
      );
    }
  }

  database.exec(`
    UPDATE passport_email_deliveries
    SET provider_status = CASE
          WHEN status = 'succeeded' THEN 'accepted'
          WHEN status = 'failed' THEN 'failed'
          ELSE provider_status
        END,
        accepted_at_ms = CASE
          WHEN status = 'succeeded' AND accepted_at_ms IS NULL THEN updated_at_ms
          ELSE accepted_at_ms
        END
    WHERE provider_status = 'pending' AND status <> 'pending';

    INSERT OR IGNORE INTO communication_passport_links (
      idempotency_key, passport_id, role, created_at_ms
    )
    SELECT idempotency_key, passport_id, 'primary', created_at_ms
    FROM passport_email_deliveries
    WHERE passport_id <> ''
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
  communicationKind = "passport",
  subject = "",
  relatedPassportIds = [],
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
            provider_status = 'pending',
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
        updated_at_ms,
        communication_kind,
        subject,
        provider_status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, 'pending')
    `).run(
      key,
      fingerprint,
      clean(passportId),
      clean(listingId),
      clean(principalId),
      JSON.stringify(recipients),
      now,
      now,
      clean(communicationKind) || "passport",
      clean(subject)
    );

    const link = db.prepare(`
      INSERT OR IGNORE INTO communication_passport_links (
        idempotency_key, passport_id, role, created_at_ms
      ) VALUES (?, ?, ?, ?)
    `);
    const primaryPassportId = clean(passportId).toUpperCase();
    if (primaryPassportId) {
      link.run(key, primaryPassportId, "primary", now);
    }
    for (const relatedPassportId of new Set(
      (Array.isArray(relatedPassportIds) ? relatedPassportIds : [])
        .map(value => clean(value).toUpperCase())
        .filter(Boolean)
    )) {
      link.run(key, relatedPassportId, "related", now);
    }

    return { acquired: true, replayed: false };
  })();
}

function completePassportEmailDelivery({
  idempotencyKey,
  messageIds,
  now = Date.now()
} = {}) {
  const db = openDatabase();
  const key = clean(idempotencyKey);
  const ids = (Array.isArray(messageIds) ? messageIds : [])
    .map(clean)
    .filter(Boolean);
  db.transaction(() => {
    const delivery = db.prepare(`
      SELECT recipients_json FROM passport_email_deliveries
      WHERE idempotency_key = ?
    `).get(key);
    const recipients = parseJson(delivery?.recipients_json, []);
    db.prepare(`
      UPDATE passport_email_deliveries
      SET status = 'succeeded',
          provider_status = 'accepted',
          provider_message_ids_json = ?,
          failure_code = NULL,
          accepted_at_ms = ?,
          last_event_at_ms = ?,
          updated_at_ms = ?
      WHERE idempotency_key = ?
    `).run(JSON.stringify(ids), now, now, now, key);

    const insert = db.prepare(`
      INSERT INTO communication_provider_messages (
        provider_message_id, idempotency_key, provider, status,
        last_event_type, last_event_at_ms, updated_at_ms
      ) VALUES (?, ?, 'amazon-ses', 'accepted', 'send', ?, ?)
      ON CONFLICT(provider_message_id) DO UPDATE SET
        idempotency_key = excluded.idempotency_key,
        status = excluded.status,
        last_event_type = excluded.last_event_type,
        last_event_at_ms = excluded.last_event_at_ms,
        updated_at_ms = excluded.updated_at_ms
    `);
    ids.forEach((messageId, index) => {
      insert.run(messageId, key, now, now);
      db.prepare(`
        UPDATE communication_provider_messages SET recipient = ?
        WHERE provider_message_id = ?
      `).run(clean(recipients[index]), messageId);
    });
  })();
}

function failPassportEmailDelivery({
  idempotencyKey,
  code,
  now = Date.now()
} = {}) {
  openDatabase().prepare(`
    UPDATE passport_email_deliveries
    SET status = 'failed',
        provider_status = 'failed',
        failure_code = ?,
        updated_at_ms = ?
    WHERE idempotency_key = ? AND status = 'pending'
  `).run(
    clean(code) || "IXI_PASSPORT_EMAIL_DELIVERY_FAILED",
    now,
    clean(idempotencyKey)
  );
}

function listCommunicationsForPassport({ passportId, limit = 100 } = {}) {
  const id = clean(passportId).toUpperCase();
  if (!id) return [];
  const size = Math.max(1, Math.min(250, Number(limit) || 100));
  const db = openDatabase();
  return db.prepare(`
    SELECT d.*, l.role AS passport_role
    FROM communication_passport_links l
    JOIN passport_email_deliveries d
      ON d.idempotency_key = l.idempotency_key
    WHERE l.passport_id = ?
    ORDER BY d.created_at_ms DESC
    LIMIT ?
  `).all(id, size).map(row => ({
    id: row.idempotency_key,
    channel: "email",
    kind: row.communication_kind || "passport",
    passportId: id,
    passportRole: row.passport_role,
    listingId: row.listing_id,
    principalId: row.principal_id,
    recipients: parseJson(row.recipients_json, []),
    recipientCount: parseJson(row.recipients_json, []).length,
    subject: row.subject || "",
    status: row.provider_status || (row.status === "succeeded" ? "accepted" : row.status),
    provider: row.provider || "amazon-ses",
    providerMessageIds: parseJson(row.provider_message_ids_json, []),
    providerMessages: db.prepare(`
      SELECT provider_message_id AS messageId, recipient, status,
             last_event_type AS lastEventType,
             last_event_at_ms AS lastEventAtMs
      FROM communication_provider_messages
      WHERE idempotency_key = ?
      ORDER BY provider_message_id
    `).all(row.idempotency_key),
    failureCode: row.failure_code || "",
    attemptCount: Number(row.attempt_count || 0),
    createdAtMs: Number(row.created_at_ms || 0),
    acceptedAtMs: Number(row.accepted_at_ms || 0) || null,
    deliveredAtMs: Number(row.delivered_at_ms || 0) || null,
    updatedAtMs: Number(row.updated_at_ms || 0)
  }));
}

function recordCommunicationProviderEvent({
  eventId,
  providerMessageId,
  eventType,
  eventAtMs = Date.now(),
  payloadHash
} = {}) {
  const normalizedType = clean(eventType).toLowerCase();
  const statuses = {
    delivery: "delivered",
    bounce: "bounced",
    complaint: "complained",
    reject: "rejected",
    deliverydelay: "delayed",
    renderingfailure: "failed"
  };
  const status = statuses[normalizedType];
  if (!status) return { recorded: false, ignored: true };
  const db = openDatabase();
  return db.transaction(() => {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO communication_provider_events (
        event_id, provider_message_id, provider, event_type,
        event_at_ms, payload_hash, created_at_ms
      ) VALUES (?, ?, 'amazon-ses', ?, ?, ?, ?)
    `).run(
      clean(eventId), clean(providerMessageId), normalizedType,
      Number(eventAtMs) || Date.now(), clean(payloadHash), Date.now()
    );
    if (!inserted.changes) return { recorded: false, replayed: true };
    const providerMessage = db.prepare(`
      SELECT idempotency_key FROM communication_provider_messages
      WHERE provider_message_id = ?
    `).get(clean(providerMessageId));
    if (!providerMessage) return { recorded: true, matched: false, status };
    db.prepare(`
      UPDATE communication_provider_messages
      SET status = ?, last_event_type = ?, last_event_at_ms = ?, updated_at_ms = ?
      WHERE provider_message_id = ?
    `).run(status, normalizedType, eventAtMs, Date.now(), clean(providerMessageId));
    const providerStatuses = db.prepare(`
      SELECT status FROM communication_provider_messages
      WHERE idempotency_key = ?
    `).all(providerMessage.idempotency_key).map(row => row.status);
    let aggregateStatus = "accepted";
    if (providerStatuses.includes("complained")) aggregateStatus = "complained";
    else if (providerStatuses.every(value => value === "delivered")) aggregateStatus = "delivered";
    else if (providerStatuses.some(value => ["bounced", "rejected", "failed"].includes(value))) {
      aggregateStatus = providerStatuses.some(value => value === "delivered") ? "partial-failure" : "failed";
    } else if (providerStatuses.some(value => value === "delivered")) aggregateStatus = "partially-delivered";
    else if (providerStatuses.some(value => value === "delayed")) aggregateStatus = "delayed";
    db.prepare(`
      UPDATE passport_email_deliveries
      SET provider_status = ?,
          delivered_at_ms = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at_ms END,
          last_event_at_ms = ?,
          failure_code = CASE WHEN ? IN ('bounced', 'complained', 'rejected', 'failed') THEN upper(?) ELSE failure_code END,
          updated_at_ms = ?
      WHERE idempotency_key = ?
    `).run(
      aggregateStatus, aggregateStatus, eventAtMs, eventAtMs, aggregateStatus, aggregateStatus,
      Date.now(), providerMessage.idempotency_key
    );
    return { recorded: true, matched: true, status: aggregateStatus };
  })();
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

function recordTextMessagingConsent({
  consentId,
  idempotencyKey,
  fingerprint,
  fullName,
  mobileE164,
  purpose,
  policyVersion,
  consentText,
  sourceUrl,
  sourceIpHash,
  userAgentHash,
  now = Date.now()
} = {}) {
  const db = openDatabase();
  const existing = db.prepare(`
    SELECT consent_id, fingerprint, status, created_at_ms
    FROM text_messaging_consents
    WHERE idempotency_key = ?
  `).get(clean(idempotencyKey));

  if (existing) {
    if (existing.fingerprint !== clean(fingerprint)) {
      throw emailError(
        "IXI_TEXT_CONSENT_IDEMPOTENCY_CONFLICT",
        "This consent token was already used for different information.",
        409
      );
    }
    return {
      consentId: existing.consent_id,
      status: existing.status,
      createdAtMs: existing.created_at_ms,
      replayed: true
    };
  }

  db.prepare(`
    INSERT INTO text_messaging_consents (
      consent_id, idempotency_key, fingerprint, full_name, mobile_e164,
      purpose, policy_version, consent_text, source_url, source_ip_hash,
      user_agent_hash, status, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    clean(consentId), clean(idempotencyKey), clean(fingerprint),
    clean(fullName), clean(mobileE164), clean(purpose), clean(policyVersion),
    clean(consentText), clean(sourceUrl), clean(sourceIpHash),
    clean(userAgentHash), now, now
  );

  return { consentId: clean(consentId), status: "active", createdAtMs: now, replayed: false };
}

function getTextMessagingConsent(consentId) {
  return openDatabase().prepare(`
    SELECT * FROM text_messaging_consents WHERE consent_id = ?
  `).get(clean(consentId)) || null;
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
  listCommunicationsForPassport,
  recordCommunicationProviderEvent,
  recordTextMessagingConsent,
  getTextMessagingConsent,
  closePassportEmailStore
};
