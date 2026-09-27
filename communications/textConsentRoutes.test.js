"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { POLICY_VERSION, CONSENT_TEXT, createTextConsentHandler } = require("./textConsentRoutes");

function response() { return { statusCode: 200, payload: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }
function request(overrides = {}) { return { headers: { "idempotency-key": "text_consent_1234567890" }, body: { fullName: "Barry Tarp", mobileNumber: "940-555-0123", accepted: true, policyVersion: POLICY_VERSION, consentText: CONSENT_TEXT, sourceUrl: "https://preview.ironxchange.com/text-consent", sourceIpHash: "abc", userAgentHash: "def" }, ...overrides }; }

test("records an explicit text consent without sending a message", () => {
  let recorded;
  const handler = createTextConsentHandler({ verifyRequest: () => ({ principalId: "public-consent" }), recordConsent: value => { recorded = value; return { consentId: value.consentId, status: "active", replayed: false }; } });
  const res = response();
  handler(request(), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(recorded.mobileE164, "+19405550123");
  assert.equal(recorded.policyVersion, POLICY_VERSION);
});

test("rejects a missing or stale explicit consent", () => {
  const handler = createTextConsentHandler({ verifyRequest: () => ({ principalId: "public-consent" }), recordConsent: () => assert.fail("must not persist") });
  for (const body of [{ accepted: false }, { policyVersion: "old" }]) {
    const req = request();
    req.body = { ...req.body, ...body };
    const res = response();
    handler(req, res);
    assert.ok([400, 409].includes(res.statusCode));
  }
});
