"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  reconcileCreationIntegrity,
  assertCreationIntegrity
} = require("./creationIntegrityService");

function healthyFixture() {
  return {
    entityId: "ENT-1",
    objects: [
      {
        objectId: "OBJ-1",
        entityId: "ENT-1",
        identities: [
          {
            identityType: "ixi-passport",
            passportId: "PASS-1"
          }
        ]
      }
    ],
    passports: [
      {
        passportId: "PASS-1",
        sourceType: "aos-object",
        sourceId: "OBJ-1"
      }
    ],
    provisioningRecords: [
      {
        commandId: "manual:aos-draft:1",
        entityId: "ENT-1",
        objectId: "OBJ-1",
        passportId: "PASS-1",
        source: "manual"
      }
    ]
  };
}

test("healthy Object Passport birth passes", () => {
  const report = reconcileCreationIntegrity(healthyFixture());
  assert.equal(report.status, "healthy");
  assert.equal(report.summary.findings, 0);
  assert.equal(assertCreationIntegrity(healthyFixture()).status, "healthy");
});

test("object without Passport identity fails", () => {
  const fixture = healthyFixture();
  fixture.objects[0].identities = [];
  const report = reconcileCreationIntegrity(fixture);
  assert.equal(report.status, "failed");
  assert.ok(report.findings.some(item => item.code === "OBJECT_PASSPORT_MISSING"));
});

test("orphan AOS Passport fails", () => {
  const fixture = healthyFixture();
  fixture.passports.push({
    passportId: "PASS-ORPHAN",
    sourceType: "aos-object",
    sourceId: "OBJ-MISSING"
  });
  const report = reconcileCreationIntegrity(fixture);
  assert.ok(report.findings.some(item => item.code === "ORPHAN_AOS_PASSPORT"));
});

test("same Passport cannot belong to multiple Objects", () => {
  const fixture = healthyFixture();
  fixture.objects.push({
    objectId: "OBJ-2",
    entityId: "ENT-1",
    identities: [{ identityType: "ixi-passport", passportId: "PASS-1" }]
  });
  const report = reconcileCreationIntegrity(fixture);
  assert.ok(report.findings.some(item => item.code === "PASSPORT_LINKED_TO_MULTIPLE_OBJECTS"));
});

test("same Object cannot have multiple AOS source Passports", () => {
  const fixture = healthyFixture();
  fixture.passports.push({
    passportId: "PASS-2",
    sourceType: "aos-object",
    sourceId: "OBJ-1"
  });
  const report = reconcileCreationIntegrity(fixture);
  assert.ok(report.findings.some(item => item.code === "OBJECT_HAS_MULTIPLE_SOURCE_PASSPORTS"));
});

test("Passport source must match object-side identity", () => {
  const fixture = healthyFixture();
  fixture.passports[0].sourceId = "OBJ-2";
  fixture.objects.push({
    objectId: "OBJ-2",
    entityId: "ENT-1",
    identities: [{ identityType: "ixi-passport", passportId: "PASS-2" }]
  });
  fixture.passports.push({
    passportId: "PASS-2",
    sourceType: "aos-object",
    sourceId: "OBJ-2"
  });
  const report = reconcileCreationIntegrity(fixture);
  assert.ok(report.findings.some(item => item.code === "OBJECT_PASSPORT_SOURCE_MISMATCH"));
});

test("idempotency command cannot resolve to conflicting births", () => {
  const fixture = healthyFixture();
  fixture.provisioningRecords.push({
    commandId: "manual:aos-draft:1",
    entityId: "ENT-1",
    objectId: "OBJ-2",
    passportId: "PASS-2",
    source: "manual"
  });
  const report = reconcileCreationIntegrity(fixture);
  assert.ok(report.findings.some(item => item.code === "PROVISIONING_COMMAND_CONFLICT"));
});

test("entity scope excludes another tenant", () => {
  const fixture = healthyFixture();
  fixture.objects.push({
    objectId: "OTHER-OBJ",
    entityId: "ENT-2",
    identities: []
  });
  const report = reconcileCreationIntegrity(fixture);
  assert.equal(report.status, "healthy");
  assert.equal(report.summary.objectsChecked, 1);
});
test("listing Passport keeps its existing identity through all AOS source bindings", () => {
  const fixture = healthyFixture();
  fixture.passports[0] = { passportId: 'PASS-1', entityId: 'ENT-1', sourceType: 'sharetribe-listing',
    sourceId: 'listing-1', sources: [{ sourceType: 'aos-object', sourceId: 'OBJ-1' }] };
  const before = JSON.stringify(fixture);
  assert.equal(reconcileCreationIntegrity(fixture).status, 'healthy');
  assert.equal(JSON.stringify(fixture), before, 'reconciliation must be read-only');
  fixture.passports[0].sources = [];
  assert.ok(reconcileCreationIntegrity(fixture).findings.some(x => x.code === 'OBJECT_PASSPORT_SOURCE_MISMATCH'));
});

test("retained tombstones remain linked but cannot become a second active owner", () => {
  const fixture = healthyFixture();
  fixture.objects.push({ ...structuredClone(fixture.objects[0]), objectId: 'OBJ-OLD', status: 'soft-deleted' });
  fixture.passports[0].sources = [{ sourceType: 'aos-object', sourceId: 'OBJ-OLD' }];
  const report = reconcileCreationIntegrity(fixture);
  assert.equal(report.status, 'healthy');
  assert.equal(report.summary.retainedObjectsChecked, 1);
  fixture.objects[1].status = 'active';
  assert.ok(reconcileCreationIntegrity(fixture).findings.some(x => x.code === 'PASSPORT_LINKED_TO_MULTIPLE_OBJECTS'));
  fixture.objects[1].status = 'soft-deleted';
  fixture.objects[1].identities = [{ identityType: 'ixi-passport', passportId: 'WRONG' }];
  assert.ok(reconcileCreationIntegrity(fixture).findings.some(x => x.code === 'PASSPORT_OBJECT_LINK_MISMATCH'));
});

test("secondary AOS bindings expose orphan and wrong-tenant defects", () => {
  const fixture = healthyFixture();
  fixture.passports[0] = { passportId: 'PASS-1', entityId: 'ENT-2', sourceType: 'sharetribe-listing', sourceId: 'listing-1',
    sources: [{ sourceType: 'aos-object', sourceId: 'OBJ-1' }, { sourceType: 'aos-object', sourceId: 'MISSING' }] };
  const codes = reconcileCreationIntegrity(fixture).findings.map(x => x.code);
  assert.ok(codes.includes('PASSPORT_ENTITY_ID_MISMATCH'));
  assert.ok(codes.includes('ORPHAN_AOS_PASSPORT'));
  fixture.passports = [];
  assert.ok(reconcileCreationIntegrity(fixture).findings.some(x => x.code === 'OBJECT_PASSPORT_RECORD_MISSING'));
});
