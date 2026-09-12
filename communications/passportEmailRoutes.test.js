"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPassportEmailHandler
} = require("./passportEmailRoutes");

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    }
  };
}

function request(overrides = {}) {
  return {
    params: { passportId: "IXIWQMZWAE" },
    headers: { "idempotency-key": "passport_send_1234567890" },
    body: {
      listingId: "6992ef66-9ac6-4a5a-b4a1-59b1652b1c4f",
      recipients: ["buyer@example.com"],
      subject: "2020 DEERE 872GP | IXI Machine Passport",
      text: "Machine Passport IXIWQMZWAE",
      html: "<html><body>Machine Passport IXIWQMZWAE</body></html>"
    },
    ...overrides
  };
}

test("Passport email rejects an unsigned internal request", async () => {
  const handler = createPassportEmailHandler({
    verifyRequest() {
      const error = new Error("signature required");
      error.code = "IXI_INTERNAL_AUTH_HEADERS_REQUIRED";
      error.status = 401;
      throw error;
    }
  });
  const res = responseRecorder();

  await handler(request(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(
    res.payload.error.code,
    "IXI_INTERNAL_AUTH_HEADERS_REQUIRED"
  );
});

test("Passport email delivers exact rendered content once", async () => {
  let sends = 0;
  let completed = null;
  const handler = createPassportEmailHandler({
    verifyRequest: () => ({ principalId: "user-123" }),
    findPassport: () => ({
      passportId: "IXIWQMZWAE",
      sourceType: "sharetribe-listing",
      sourceId: "6992ef66-9ac6-4a5a-b4a1-59b1652b1c4f"
    }),
    consumeRate: () => ({ count: 1 }),
    claimDelivery: () => ({ acquired: true, replayed: false }),
    completeDelivery: value => {
      completed = value;
    },
    failDelivery: () => {
      assert.fail("successful delivery must not be failed");
    },
    sendEmail: async value => {
      sends += 1;
      assert.equal(value.to, "buyer@example.com");
      assert.match(value.html, /IXIWQMZWAE/);
      return { messageId: "ses-message-1", accepted: true };
    }
  });
  const res = responseRecorder();

  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.delivery.recipientCount, 1);
  assert.equal(res.payload.delivery.replayed, false);
  assert.equal(sends, 1);
  assert.deepEqual(completed.messageIds, ["ses-message-1"]);
});

test("Passport email blocks a listing that is not bound to the Passport", async () => {
  const handler = createPassportEmailHandler({
    verifyRequest: () => ({ principalId: "user-123" }),
    findPassport: () => ({
      passportId: "IXIWQMZWAE",
      sourceType: "sharetribe-listing",
      sourceId: "different-listing-id"
    })
  });
  const res = responseRecorder();

  await handler(request(), res);

  assert.equal(res.statusCode, 409);
  assert.equal(
    res.payload.error.code,
    "IXI_PASSPORT_EMAIL_LISTING_MISMATCH"
  );
});

test("Passport email returns an idempotent replay without sending again", async () => {
  const handler = createPassportEmailHandler({
    verifyRequest: () => ({ principalId: "user-123" }),
    findPassport: () => ({
      passportId: "IXIWQMZWAE",
      sourceType: "sharetribe-listing",
      sourceId: "6992ef66-9ac6-4a5a-b4a1-59b1652b1c4f"
    }),
    consumeRate: () => ({ count: 2 }),
    claimDelivery: () => ({
      acquired: false,
      replayed: true,
      result: { recipientCount: 1, messageIds: ["ses-message-1"] }
    }),
    sendEmail: async () => {
      assert.fail("replayed delivery must not send");
    }
  });
  const res = responseRecorder();

  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.delivery.replayed, true);
});
