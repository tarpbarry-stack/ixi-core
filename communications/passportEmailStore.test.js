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
