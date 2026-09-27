"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { assertSnsUrl, canonicalSnsMessage, createSesEventHandler } = require("./sesEventRoutes");

function responseRecorder() {
  return { headers: {}, statusCode: 200, payload: null, setHeader(name, value) { this.headers[name] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; return this; } };
}

test("SNS validation accepts only Amazon HTTPS certificate and subscription hosts", () => {
  assert.equal(assertSnsUrl("https://sns.us-east-2.amazonaws.com/SimpleNotificationService-test.pem", "certificate").hostname, "sns.us-east-2.amazonaws.com");
  assert.throws(() => assertSnsUrl("https://example.com/SimpleNotificationService-test.pem", "certificate"));
  assert.throws(() => assertSnsUrl("http://sns.us-east-2.amazonaws.com/SimpleNotificationService-test.pem", "certificate"));
});

test("SNS canonical message preserves the documented signed field order", () => {
  const canonical = canonicalSnsMessage({ Type: "Notification", Message: "body", MessageId: "id", Timestamp: "time", TopicArn: "arn" });
  assert.equal(canonical, "Message\nbody\nMessageId\nid\nTimestamp\ntime\nTopicArn\narn\nType\nNotification\n");
});

test("verified SES callbacks record provider lifecycle without sending", async () => {
  let recorded;
  const handler = createSesEventHandler({
    verify: async () => true,
    record: value => { recorded = value; return { recorded: true, matched: true, status: "delivered" }; }
  });
  const res = responseRecorder();
  await handler({ body: { Type: "Notification", MessageId: "sns-1", Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-1", timestamp: "2026-09-27T12:00:00.000Z" }, delivery: { timestamp: "2026-09-27T12:00:01.000Z" } }) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(recorded.providerMessageId, "ses-1");
  assert.equal(recorded.eventType, "Delivery");
});
