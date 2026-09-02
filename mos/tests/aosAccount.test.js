const fs = require("fs");
const path = require("path");
const assert = require("assert");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-aos-account-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT =
  TEST_ROOT;

fs.rmSync(TEST_ROOT, {
  recursive: true,
  force: true
});

const {
  ensureAosAccount
} = require(
  "../accounts/aosAccountService"
);

const first =
  ensureAosAccount({
    ownerUserId:
      "sharetribe-owner-1",

    displayName:
      "Barry Equipment",

    metadata: {
      test: true
    }
  });

assert.ok(
  first.account.accountId
);

assert.ok(
  first.account.tenantId
);

assert.ok(
  first.entity.entityId
);

assert.strictEqual(
  first.membership.role,
  "owner"
);

assert.deepStrictEqual(
  first.membership.permissions,
  ["*"]
);

assert.strictEqual(
  first.created.account,
  true
);

const second =
  ensureAosAccount({
    ownerUserId:
      "sharetribe-owner-1",

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
  second.membership.membershipId,
  first.membership.membershipId
);

assert.strictEqual(
  second.created.account,
  false
);

assert.strictEqual(
  second.created.entity,
  false
);

assert.strictEqual(
  second.created.membership,
  false
);

console.log(
  JSON.stringify(
    {
      ok: true,
      accountId:
        first.account.accountId,
      tenantId:
        first.account.tenantId,
      entityId:
        first.entity.entityId,
      membershipId:
        first.membership
          .membershipId,
      secondCallReusedAccount:
        second.account.accountId ===
        first.account.accountId,
      testRoot: TEST_ROOT
    },
    null,
    2
  )
);
