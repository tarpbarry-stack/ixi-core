"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-read-budget-"));
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
const { MOS_PATHS } = require("./mosPaths");
const { withCanonicalReadScope, readCanonicalSnapshot } = require("./canonicalReadScope");
const { resolveCanonicalObjectIdentity } = require("../identity/canonicalObjectAdmissionService");
const { readPassportRecords, writePassportRecords } = require("../../passport/passportRegistry");

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("200 objects and repeated relationship admissions read each canonical registry only once per request", () => {
  const objects = Object.fromEntries(Array.from({ length: 200 }, (_, index) => {
    const objectId = `object-${index}`, passportId = `IXI-TEST-${index}`;
    return [objectId, { objectId, passportId, entityId: "entity-test", status: "active" }];
  }));
  const passports = Object.values(objects).map(object => ({ passportId: object.passportId,
    entityId: object.entityId, sourceType: "aos-object", sourceId: object.objectId }));
  fs.mkdirSync(path.dirname(MOS_PATHS.objects), { recursive: true });
  fs.writeFileSync(MOS_PATHS.objects, JSON.stringify(objects));
  fs.writeFileSync(process.env.IXI_PASSPORT_DATA_FILE, JSON.stringify(passports));
  const expected = resolveCanonicalObjectIdentity({ entityId: "entity-test", objectId: "object-0" });
  const reads = new Map(), originalRead = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    const key = String(file);
    reads.set(key, (reads.get(key) || 0) + 1);
    return originalRead.call(this, file, ...args);
  };
  try {
    const admit = () => withCanonicalReadScope(() => {
      for (const object of Object.values(objects)) {
        for (let repeat = 0; repeat < 3; repeat++) {
          const result = resolveCanonicalObjectIdentity({ entityId: object.entityId, objectId: object.objectId });
          assert.equal(result.passportId, object.passportId);
          if (object.objectId === "object-0") assert.deepEqual(result, expected);
        }
      }
      assert.throws(() => resolveCanonicalObjectIdentity({ entityId: "foreign-entity", objectId: "object-0" }),
        { code: "CANONICAL_ENTITY_MISMATCH" });
      assert.throws(() => writePassportRecords(passports), { code: "CANONICAL_READ_SCOPE_WRITE_DENIED" });
    });
    admit();
    assert.equal(reads.get(MOS_PATHS.objects), 1);
    assert.equal(reads.get(process.env.IXI_PASSPORT_DATA_FILE), 1);
    admit();
    assert.equal(reads.get(MOS_PATHS.objects), 2, "a new request must read fresh Objects");
    assert.equal(reads.get(process.env.IXI_PASSPORT_DATA_FILE), 2, "a new request must read fresh Passports");
  } finally { fs.readFileSync = originalRead; }
  const changed = [...passports, { ...passports[0], passportId: "IXI-CONFLICT" }];
  writePassportRecords(changed);
  assert.throws(() => withCanonicalReadScope(() => resolveCanonicalObjectIdentity({ entityId: "entity-test", objectId: "object-0" })),
    { code: "CANONICAL_IDENTITY_CONFLICT" });
  assert.equal(readPassportRecords().length, 201);
});

test("concurrent requests isolate snapshots; nesting reuses inputs, never permission decisions", async () => {
  const run = value => withCanonicalReadScope(async () => {
    const first = readCanonicalSnapshot("fixture", () => ({ value }));
    await new Promise(resolve => setImmediate(resolve));
    return withCanonicalReadScope(() => {
      assert.equal(readCanonicalSnapshot("fixture", () => { throw new Error("duplicate read"); }), first);
      assert.equal(Object.isFrozen(first), true);
      return first.value;
    });
  });
  assert.deepEqual(await Promise.all([run("first"), run("second")]), ["first", "second"]);
  assert.equal(readCanonicalSnapshot("fixture", () => "outside"), "outside");
});
