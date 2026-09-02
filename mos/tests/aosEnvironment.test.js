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

const first =
  loadAosEnvironment({
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

const second =
  loadAosEnvironment({
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
