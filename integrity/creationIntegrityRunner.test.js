"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCreationIntegrityRunner
} = require("./creationIntegrityRunner");

function healthyFixtures(entityId) {
  return {
    objects: [{
      objectId: "object_1",
      entityId,
      identities: [{ identityType: "ixi-passport", passportId: "IXI1", sourceType: "aos-object", sourceId: "object_1" }]
    }],
    passports: [{
      passportId: "IXI1",
      entityId,
      sourceType: "aos-object",
      sourceId: "object_1",
      createdAt: "2026-08-18T05:00:00.000Z"
    }],
    provisioningRecords: [{
      commandId: "cmd_1",
      entityId,
      objectId: "object_1",
      passportId: "IXI1",
      source: "test"
    }]
  };
}

function createHarness({ mutate } = {}) {
  const entityId = "entity_1";
  const base = healthyFixtures(entityId);
  const data = mutate ? mutate(base) : base;
  const states = new Map();
  const alerts = [];
  let tick = 0;

  const runner = createCreationIntegrityRunner({
    listEntityIds: async () => [entityId],
    loadObjects: async () => data.objects,
    loadPassports: async () => data.passports,
    loadProvisioningRecords: async () => data.provisioningRecords,
    loadState: async ({ entityId: id }) => states.get(id) || null,
    saveState: async ({ entityId: id, state }) => states.set(id, state),
    emitAlert: async alert => alerts.push(alert),
    passportEntityEnforcementAt: "2026-08-18T04:38:35.867Z",
    now: () => `2026-08-18T05:00:0${tick++}.000Z`,
    logger: { error() {} }
  });

  return { runner, states, alerts, data };
}

test("healthy run emits no alert", async () => {
  const { runner, alerts } = createHarness();
  const result = await runner.runAll();
  assert.equal(result.healthy, true);
  assert.equal(alerts.length, 0);
});

test("incident emits once and duplicate defect is suppressed", async () => {
  const { runner, alerts } = createHarness({
    mutate(base) {
      return {
        ...base,
        passports: base.passports.map(item => ({ ...item, entityId: null }))
      };
    }
  });

  const first = await runner.runAll();
  const second = await runner.runAll();
  assert.equal(first.unhealthyTenants, 1);
  assert.equal(second.unhealthyTenants, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "incident");
  assert.equal(alerts[0].findings[0].code, "PASSPORT_ENTITY_ID_MISSING");
});

test("changed defect fingerprint emits a new incident", async () => {
  const { runner, alerts, data } = createHarness({
    mutate(base) {
      base.passports[0].entityId = null;
      return base;
    }
  });

  await runner.runAll();
  data.passports[0].entityId = "entity_wrong";
  await runner.runAll();
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].kind, "incident");
  assert.equal(alerts[1].kind, "incident");
});

test("recovery emits after unhealthy state clears", async () => {
  const { runner, alerts, data } = createHarness({
    mutate(base) {
      base.passports[0].entityId = null;
      return base;
    }
  });

  await runner.runAll();
  data.passports[0].entityId = "entity_1";
  await runner.runAll();

  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].kind, "incident");
  assert.equal(alerts[1].kind, "recovery");
});

test("alert sink failure is retried on next run", async () => {
  const entityId = "entity_1";
  const data = healthyFixtures(entityId);
  data.passports[0].entityId = null;
  const states = new Map();
  let attempts = 0;

  const runner = createCreationIntegrityRunner({
    listEntityIds: async () => [entityId],
    loadObjects: async () => data.objects,
    loadPassports: async () => data.passports,
    loadProvisioningRecords: async () => data.provisioningRecords,
    loadState: async ({ entityId: id }) => states.get(id) || null,
    saveState: async ({ entityId: id, state }) => states.set(id, state),
    emitAlert: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("sink unavailable");
    },
    passportEntityEnforcementAt: "2026-08-18T04:38:35.867Z",
    logger: { error() {} }
  });

  const first = await runner.runAll();
  const second = await runner.runAll();
  assert.equal(first.results[0].alertEmitted, false);
  assert.equal(second.results[0].alertEmitted, true);
  assert.equal(attempts, 2);
});