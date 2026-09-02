const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  createMosId
} = require("../objects/objectIdEngine");

const {
  createEntity,
  getEntity
} = require("../entities/entityService");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

function readAccounts() {
  return readJsonFile(
    MOS_PATHS.accounts,
    {}
  );
}

function readMemberships() {
  return readJsonFile(
    MOS_PATHS.memberships,
    {}
  );
}

function findAccountByOwnerUserId(
  ownerUserId
) {
  const normalizedUserId =
    cleanText(ownerUserId);

  const accounts = readAccounts();

  return (
    Object.values(accounts).find(
      account =>
        account.ownerUserId ===
          normalizedUserId &&
        account.status === "active"
    ) || null
  );
}

function findOwnerMembership({
  accountId,
  ownerUserId
}) {
  const memberships =
    readMemberships();

  return (
    Object.values(memberships).find(
      membership =>
        membership.accountId ===
          accountId &&
        membership.principalType ===
          "sharetribe-user" &&
        membership.principalId ===
          ownerUserId &&
        membership.role === "owner" &&
        membership.status === "active"
    ) || null
  );
}

function createOwnerMembership({
  accountId,
  tenantId,
  entityId,
  ownerUserId
}) {
  const memberships =
    readMemberships();

  const membershipId =
    createMosId("membership");

  const timestamp = nowIso();

  const membership = {
    membershipId,
    accountId,
    tenantId,
    entityId,

    principalType:
      "sharetribe-user",

    principalId:
      ownerUserId,

    role: "owner",
    status: "active",

    permissions: ["*"],

    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null
  };

  memberships[membershipId] =
    membership;

  writeJsonFileAtomic(
    MOS_PATHS.memberships,
    memberships
  );

  return membership;
}

function ensureAosAccount({
  ownerUserId,
  displayName = "IXI Entity",
  metadata = {}
}) {
  const normalizedUserId =
    cleanText(ownerUserId);

  if (!normalizedUserId) {
    throw new MosError(
      "AOS_OWNER_USER_REQUIRED",
      "Authenticated owner user ID is required.",
      null,
      401
    );
  }

  const accounts = readAccounts();

  let account =
    findAccountByOwnerUserId(
      normalizedUserId
    );

  let accountCreated = false;
  let entityCreated = false;
  let membershipCreated = false;

  if (!account) {
    const accountId =
      createMosId("account");

    const tenantId =
      createMosId("tenant");

    const entity = createEntity({
      displayName:
        cleanText(displayName) ||
        "IXI Entity",

      sharetribeUserId:
        normalizedUserId,

      actorId:
        normalizedUserId,

      metadata: {
        ...metadata,
        accountId,
        tenantId,
        source:
          "aos-account-bootstrap"
      }
    });

    const timestamp = nowIso();

    account = {
      accountId,
      tenantId,

      ownerUserId:
        normalizedUserId,

      primaryEntityId:
        entity.entityId,

      status: "active",

      settings: {
        productName: "IXI AOS",
        defaultCurrency: "USD",
        defaultLanguage: "en",
        customObjectTypesEnabled: true
      },

      metadata:
        metadata &&
        typeof metadata === "object"
          ? metadata
          : {},

      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null
    };

    accounts[accountId] =
      account;

    writeJsonFileAtomic(
      MOS_PATHS.accounts,
      accounts
    );

    accountCreated = true;
    entityCreated = true;
  }

  let entity;

  try {
    entity = getEntity(
      account.primaryEntityId
    );
  } catch {
    entity = createEntity({
      displayName:
        cleanText(displayName) ||
        "IXI Entity",

      sharetribeUserId:
        normalizedUserId,

      actorId:
        normalizedUserId,

      metadata: {
        ...metadata,
        accountId:
          account.accountId,
        tenantId:
          account.tenantId,
        source:
          "aos-account-repair"
      }
    });

    account = {
      ...account,
      primaryEntityId:
        entity.entityId,
      updatedAt: nowIso()
    };

    accounts[
      account.accountId
    ] = account;

    writeJsonFileAtomic(
      MOS_PATHS.accounts,
      accounts
    );

    entityCreated = true;
  }

  let membership =
    findOwnerMembership({
      accountId:
        account.accountId,
      ownerUserId:
        normalizedUserId
    });

  if (!membership) {
    membership =
      createOwnerMembership({
        accountId:
          account.accountId,

        tenantId:
          account.tenantId,

        entityId:
          entity.entityId,

        ownerUserId:
          normalizedUserId
      });

    membershipCreated = true;
  }

  return {
    account,
    entity,
    membership,

    created: {
      account: accountCreated,
      entity: entityCreated,
      membership:
        membershipCreated
    }
  };
}

function getAosAccountForUser(
  ownerUserId
) {
  const account =
    findAccountByOwnerUserId(
      ownerUserId
    );

  if (!account) {
    throw new MosError(
      "AOS_ACCOUNT_NOT_FOUND",
      "AOS account was not found.",
      {
        ownerUserId:
          cleanText(ownerUserId)
      },
      404
    );
  }

  const entity =
    getEntity(
      account.primaryEntityId
    );

  const membership =
    findOwnerMembership({
      accountId:
        account.accountId,

      ownerUserId:
        cleanText(ownerUserId)
    });

  return {
    account,
    entity,
    membership
  };
}

module.exports = {
  ensureAosAccount,
  getAosAccountForUser,
  findAccountByOwnerUserId
};
