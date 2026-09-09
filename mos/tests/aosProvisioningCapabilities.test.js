"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-aos-capabilities-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { createEntity } = require("../entities/entityService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const { getObject } = require("../objects/objectService");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test("provisioning creates permanent identity without manufacturing action authority", () => {
  const entity = createEntity({ displayName: "Universal Object Company", actorId: "owner-1" });
  const result = provisionAosObject({
    commandId: "provision-universal-object-001",
    entityId: entity.entityId,
    objectType: "generic",
    displayName: "Whatever The Customer Defines",
    cardTemplateSlug: "location-standard-003",
    fields: { addressLine1: "2400 Aviation Drive" },
    actorId: "owner-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.transact.eligible, true);
  assert.ok(result.passport.passportId);
  const persisted = getObject(result.object.objectId);
  assert.equal(persisted.metadata.transactEligible, true);
  assert.equal(persisted.capabilities.canTransact, undefined);
  assert.equal(persisted.capabilities.canContain, true);
  assert.equal(persisted.capabilities.canCreate, undefined);
});
