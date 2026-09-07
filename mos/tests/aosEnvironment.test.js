const fs = require("fs");
const path = require("path");
const assert = require("assert");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-aos-environment-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT =
  TEST_ROOT;

fs.rmSync(TEST_ROOT, {
  recursive: true,
  force: true
});

const {
  loadAosEnvironment
} = require(
  "../accounts/aosEnvironmentService"
);

const {
  createObject
} = require(
  "../objects/objectService"
);

const {
  readJsonFile,
  writeJsonFileAtomic
} = require(
  "../storage/jsonStore"
);

const {
  MOS_PATHS
} = require(
  "../storage/mosPaths"
);

(async () => {
const first =
  await loadAosEnvironment({
    ownerUserId:
      "sharetribe-owner-2",

    displayName:
      "Barry Equipment"
  });

assert.ok(
  first.account.accountId
);

assert.ok(
  first.account.tenantId
);

assert.strictEqual(
  first.entity.displayName,
  "Barry Equipment"
);

assert.strictEqual(
  first.principal.role,
  "owner"
);

assert.deepStrictEqual(
  first.principal.permissions,
  ["*"]
);

assert.strictEqual(
  first.objects.length,
  0
);

const job =
  createObject({
    entityId:
      first.entity.entityId,

    objectType: "job",
    displayName: "Job 41",

    actorId:
      "sharetribe-owner-2"
  });

const tool =
  createObject({
    entityId:
      first.entity.entityId,

    objectType: "tool",
    displayName:
      "Impact Wrench",

    value: 850,

    actorId:
      "sharetribe-owner-2"
  });

/* Simulate a canonical Object written before universal containment. */
const legacyObjects =
  readJsonFile(
    MOS_PATHS.objects,
    {}
  );

legacyObjects[job.objectId] = {
  ...legacyObjects[job.objectId],
  capabilities: {
    ...legacyObjects[job.objectId].capabilities,
    canContain: false,
    canCreate: false
  }
};

writeJsonFileAtomic(
  MOS_PATHS.objects,
  legacyObjects
);

const second =
  await loadAosEnvironment({
    ownerUserId:
      "sharetribe-owner-2",

    displayName:
      "Barry Equipment"
  });

assert.strictEqual(
  second.account.accountId,
  first.account.accountId
);

assert.strictEqual(
  second.entity.entityId,
  first.entity.entityId
);

assert.strictEqual(
  second.objects.length,
  2
);

assert.strictEqual(
  second.rootObjects.length,
  2
);

for (const object of second.objects) {
  assert.strictEqual(
    object.capabilities.canContain,
    true
  );

  assert.strictEqual(
    object.capabilities.canCreate,
    true
  );
}

assert.ok(
  second.objects.find(
    object => object.objectId === job.objectId
  ).revision > job.revision
);

assert.ok(
  second.projections[
    job.objectId
  ]
);

assert.strictEqual(
  second.bootstrap.account,
  false
);

console.log(
  JSON.stringify(
    {
      ok: true,

      accountId:
        second.account.accountId,

      tenantId:
        second.account.tenantId,

      entityId:
        second.entity.entityId,

      objectIds:
        second.objects.map(
          object =>
            object.objectId
        ),

      rootObjectCount:
        second.rootObjects.length,

      projectionIds:
        Object.keys(
          second.projections
        ),

      secondCallReusedAccount:
        second.account.accountId ===
        first.account.accountId,

      testRoot:
        TEST_ROOT
    },
    null,
    2
  )
);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
