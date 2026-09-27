"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  consumePassportEmailRate,
  claimPassportEmailDelivery,
  completePassportEmailDelivery,
  listCommunicationsForPassport,
  recordCommunicationProviderEvent,
  closePassportEmailStore
} = require("./passportEmailStore");

function withDatabase(operation) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ixi-passport-email-")
  );
  process.env.IXI_EMAIL_DB_PATH =
    path.join(directory, "email.sqlite");

  try {
    return operation();
  } finally {
    closePassportEmailStore();
    delete process.env.IXI_EMAIL_DB_PATH;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("delivery success is durable and replayed", () => {
  withDatabase(() => {
    const input = {
      idempotencyKey: "passport_send_1234567890",
      fingerprint: "fingerprint-a",
      passportId: "IXIWQMZWAE",
      listingId: "listing-12345678",
      principalId: "user-123",
      recipients: ["buyer@example.com"],
      now: 1000
    };

    const first = claimPassportEmailDelivery(input);
    assert.equal(first.acquired, true);

    completePassportEmailDelivery({
      idempotencyKey: input.idempotencyKey,
      messageIds: ["ses-message-1"],
      now: 1100
    });

    closePassportEmailStore();
    const replay = claimPassportEmailDelivery({
      ...input,
      now: 1200
    });

    assert.equal(replay.replayed, true);
    assert.equal(replay.result.recipientCount, 1);
    assert.deepEqual(replay.result.messageIds, ["ses-message-1"]);
  });
});

test("one communication is linked to every participating Passport", () => {
  withDatabase(() => {
    claimPassportEmailDelivery({
      idempotencyKey: "transact_send_1234567890",
      fingerprint: "fingerprint-transact",
      passportId: "IXIENTITY01",
      listingId: "ifd_invoice_1",
      principalId: "person-123",
      recipients: ["buyer@example.com"],
      communicationKind: "transact-document",
      subject: "IXI TRAN$ACT · INV-1001",
      relatedPassportIds: ["IXIMACHINE1", "IXIMACHINE2"],
      now: 2000
    });
    completePassportEmailDelivery({
      idempotencyKey: "transact_send_1234567890",
      messageIds: ["ses-transact-1"],
      now: 2100
    });

    const machineHistory = listCommunicationsForPassport({
      passportId: "IXIMACHINE1"
    });
    assert.equal(machineHistory.length, 1);
    assert.equal(machineHistory[0].kind, "transact-document");
    assert.equal(machineHistory[0].status, "accepted");
    assert.equal(machineHistory[0].subject, "IXI TRAN$ACT · INV-1001");
  });
});

test("provider events advance accepted mail without claiming false delivery", () => {
  withDatabase(() => {
    claimPassportEmailDelivery({
      idempotencyKey: "passport_event_1234567890",
      fingerprint: "fingerprint-event",
      passportId: "IXIMACHINE1",
      listingId: "listing-12345678",
      principalId: "person-123",
      recipients: ["buyer@example.com"],
      now: 3000
    });
    completePassportEmailDelivery({
      idempotencyKey: "passport_event_1234567890",
      messageIds: ["ses-event-1"],
      now: 3100
    });
    assert.equal(
      listCommunicationsForPassport({ passportId: "IXIMACHINE1" })[0].status,
      "accepted"
    );
    const recorded = recordCommunicationProviderEvent({
      eventId: "event-delivery-1",
      providerMessageId: "ses-event-1",
      eventType: "Delivery",
      eventAtMs: 3200,
      payloadHash: "hash-1"
    });
    assert.equal(recorded.matched, true);
    assert.equal(
      listCommunicationsForPassport({ passportId: "IXIMACHINE1" })[0].status,
      "delivered"
    );
    assert.equal(
      recordCommunicationProviderEvent({
        eventId: "event-delivery-1",
        providerMessageId: "ses-event-1",
        eventType: "Delivery",
        eventAtMs: 3200,
        payloadHash: "hash-1"
      }).replayed,
      true
    );
  });
});

test("an idempotency key cannot be reused for different content", () => {
  withDatabase(() => {
    const base = {
      idempotencyKey: "passport_send_1234567890",
      fingerprint: "fingerprint-a",
      passportId: "IXIWQMZWAE",
      listingId: "listing-12345678",
      principalId: "user-123",
      recipients: ["buyer@example.com"],
      now: 1000
    };

    claimPassportEmailDelivery(base);

    assert.throws(
      () => claimPassportEmailDelivery({
        ...base,
        fingerprint: "fingerprint-b",
        now: 200000
      }),
      error =>
        error.code ===
        "IXI_PASSPORT_EMAIL_IDEMPOTENCY_CONFLICT"
    );
  });
});

test("rate limits are durable per authenticated principal", () => {
  withDatabase(() => {
    const base = {
      principalId: "user-123",
      limit: 2,
      windowMs: 1000,
      now: 100
    };

    assert.equal(consumePassportEmailRate(base).count, 1);
    assert.equal(consumePassportEmailRate(base).count, 2);
    assert.throws(
      () => consumePassportEmailRate(base),
      error =>
        error.code === "IXI_PASSPORT_EMAIL_RATE_LIMITED" &&
        error.status === 429
    );

    closePassportEmailStore();
    assert.throws(
      () => consumePassportEmailRate(base),
      error => error.code === "IXI_PASSPORT_EMAIL_RATE_LIMITED"
    );
  });
});
