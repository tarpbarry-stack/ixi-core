"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("SES lifecycle infrastructure is encrypted, scoped and activated after runtime configuration", () => {
  const template = fs.readFileSync(
    path.join(root, "ops/cloudformation/ixi-communications-events.yaml"),
    "utf8"
  );
  const deploy = fs.readFileSync(
    path.join(root, "ops/deploy-complete-runtime.sh"),
    "utf8"
  );

  assert.match(template, /TopicName: ixi-ses-communication-events/u);
  assert.match(template, /EnableKeyRotation: true/u);
  assert.match(template, /Principal:\s+Service: ses\.amazonaws\.com/u);
  assert.match(template, /AWS:SourceAccount/u);
  assert.match(template, /AWS:SourceArn/u);
  assert.match(template, /Condition: DeliveryEventsEnabled/u);
  assert.match(template, /communications\/v1\/provider-events\/ses/u);
  for (const event of ["delivery", "deliveryDelay", "bounce", "complaint", "reject", "renderingFailure"]) {
    assert.match(template, new RegExp(`- ${event}\\b`, "u"));
  }

  assert.match(deploy, /IXI_SES_EVENT_TOPIC_ARN:\?Authorized SES event topic is required/u);
  assert.match(deploy, /ixi-ses-communication-events/u);
  assert.match(deploy, /run_pm2_with_runtime_env restart.*--update-env/u);
  assert.match(deploy, /run_pm2 save/u);
});
