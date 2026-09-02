"use strict";

const crypto =
  require("crypto");

const {
  DynamoDBClient
} =
  require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand
} =
  require("@aws-sdk/lib-dynamodb");


const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-2";


const TABLE_NAME =
  process.env.IXI_FINANCIAL_DDB_TABLE ||
  "ixi-financial-v1";


const rawClient =
  new DynamoDBClient({
    region:
      REGION
  });


const client =
  DynamoDBDocumentClient.from(
    rawClient,
    {
      marshallOptions: {
        removeUndefinedValues:
          true,

        convertClassInstanceToMap:
          true
      }
    }
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function nowIso() {
  return new Date()
    .toISOString();
}


function randomId() {
  return crypto
    .randomBytes(12)
    .toString("hex");
}


function documentPk(
  financialDocumentId
) {
  return `FIN#${clean(
    financialDocumentId
  )}`;
}


function revisionSk(
  revision
) {
  return `REV#${String(
    Number(
      revision ||
      0
    )
  ).padStart(
    10,
    "0"
  )}`;
}


function passportPk(
  passportId
) {
  return `PASS#${clean(
    passportId
  )}`;
}



function entityPk(
  entityPassportId
) {
  return `ENTITY#${clean(
    entityPassportId
  )}`;
}


function accountSk(
  accountCode
) {
  return `ACCOUNT#${clean(
    accountCode
  )}`;
}


function idempotencyPk(
  idempotencyKey
) {
  return `IDEM#${clean(
    idempotencyKey
  )}`;
}


async function getCurrentDocumentRecord(
  financialDocumentId
) {
  const id =
    clean(
      financialDocumentId
    );

  if (!id) {
    return null;
  }

  const result =
    await client.send(
      new GetCommand({
        TableName:
          TABLE_NAME,

        Key: {
          PK:
            documentPk(id),

          SK:
            "CURRENT"
        },

        ConsistentRead:
          true
      })
    );

  return result.Item
    ?.record ||
    null;
}


async function getFinancialDocumentHistory(
  financialDocumentId
) {
  const id =
    clean(
      financialDocumentId
    );

  if (!id) {
    return [];
  }

  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          "PK = :pk AND begins_with(SK, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            documentPk(id),

          ":prefix":
            "REV#"
        },

        ConsistentRead:
          true,

        ScanIndexForward:
          true
      })
    );

  return safeArray(
    result.Items
  )
    .map(
      item =>
        item.historyRecord
    )
    .filter(Boolean);
}


async function getIdempotencyRecord(
  idempotencyKey
) {
  const key =
    clean(
      idempotencyKey
    );

  if (!key) {
    return null;
  }

  const result =
    await client.send(
      new GetCommand({
        TableName:
          TABLE_NAME,

        Key: {
          PK:
            idempotencyPk(key),

          SK:
            "RESULT"
        },

        ConsistentRead:
          true
      })
    );

  return result.Item
    ?.idempotencyRecord ||
    null;
}


async function getPassportDocumentIds(
  passportId
) {
  const id =
    clean(
      passportId
    );

  if (!id) {
    return [];
  }

  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          "PK = :pk AND begins_with(SK, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            passportPk(id),

          ":prefix":
            "DOC#"
        },

        ConsistentRead:
          true
      })
    );

  return safeArray(
    result.Items
  )
    .map(
      item =>
        clean(
          item.financialDocumentId
        )
    )
    .filter(Boolean);
}


async function getEntityDocumentIds(
  entityPassportId
) {
  const id =
    clean(
      entityPassportId
    );

  if (!id) {
    return [];
  }


  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          "PK = :pk AND begins_with(SK, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            entityPk(id),

          ":prefix":
            "DOC#"
        },

        ConsistentRead:
          true
      })
    );


  return safeArray(
    result.Items
  )
    .map(
      item =>
        clean(
          item.financialDocumentId
        )
    )
    .filter(Boolean);
}


async function getDocumentPassportIds(
  financialDocumentId
) {
  const id =
    clean(
      financialDocumentId
    );

  if (!id) {
    return [];
  }

  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        IndexName:
          "GSI1",

        KeyConditionExpression:
          "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            `DOC#${id}`,

          ":prefix":
            "PASS#"
        }
      })
    );

  return safeArray(
    result.Items
  )
    .map(
      item =>
        clean(
          item.passportId
        )
    )
    .filter(Boolean);
}


async function createDocumentRecord({
  record,
  passportIds = [],
  idempotencyKey = "",
  commandId = "",
  actorPassportId = ""
} = {}) {
  const source =
    safeObject(
      record
    );

  const financialDocumentId =
    clean(
      source
        ?.financialDocument
        ?.financialDocumentId
    );

  if (!financialDocumentId) {
    throw new Error(
      "financialDocumentId is required."
    );
  }

  const revision =
    Number(
      source
        ?.server
        ?.revision ||
      1
    );

  const timestamp =
    clean(
      source
        ?.server
        ?.updatedAt ||
      source
        ?.server
        ?.createdAt
    ) ||
    nowIso();



  const entityPassportId =
    clean(
      source
        ?.server
        ?.entityPassportId
    );


  if (!entityPassportId) {
    throw new Error(
      "Financial document requires server.entityPassportId."
    );
  }

  const historyRecord = {
    historyId:
      `ifh_${randomId()}`,

    financialDocumentId,

    revision,

    operation:
      "create",

    actorPassportId:
      clean(
        actorPassportId
      ),

    commandId:
      clean(
        commandId
      ),

    recordedAt:
      timestamp,

    record:
      source
  };

  const transactItems = [
    {
      Put: {
        TableName:
          TABLE_NAME,

        Item: {
          PK:
            documentPk(
              financialDocumentId
            ),

          SK:
            "CURRENT",

          entityType:
            "financial-document-current",

          financialDocumentId,

          revision,

          updatedAt:
            timestamp,

          record:
            source
        },

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    },

    {
      Put: {
        TableName:
          TABLE_NAME,

        Item: {
          PK:
            documentPk(
              financialDocumentId
            ),

          SK:
            revisionSk(
              revision
            ),

          entityType:
            "financial-document-revision",

          financialDocumentId,

          revision,

          recordedAt:
            timestamp,

          historyRecord
        },

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    }
  ];

  const idem =
    clean(
      idempotencyKey
    );

  if (idem) {
    transactItems.push({
      Put: {
        TableName:
          TABLE_NAME,

        Item: {
          PK:
            idempotencyPk(idem),

          SK:
            "RESULT",

          entityType:
            "financial-idempotency",

          idempotencyRecord: {
            idempotencyKey:
              idem,

            operation:
              "create",

            financialDocumentId,

            revision,

            completedAt:
              timestamp
          }
        },

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    });
  }

  transactItems.push({
    Put: {
      TableName:
        TABLE_NAME,

      Item: {
        PK:
          entityPk(
            entityPassportId
          ),

        SK:
          `DOC#${financialDocumentId}`,

        entityType:
          "financial-entity-index",

        entityPassportId,

        financialDocumentId,

        updatedAt:
          timestamp
      },

      ConditionExpression:
        "attribute_not_exists(PK)"
    }
  });


  Array.from(
    new Set(
      safeArray(
        passportIds
      )
        .map(clean)
        .filter(Boolean)
    )
  ).forEach(
    passportId => {
      transactItems.push({
        Put: {
          TableName:
            TABLE_NAME,

          Item: {
            PK:
              passportPk(
                passportId
              ),

            SK:
              `DOC#${financialDocumentId}`,

            GSI1PK:
              `DOC#${financialDocumentId}`,

            GSI1SK:
              `PASS#${passportId}`,

            entityType:
              "financial-passport-index",

            passportId,

            financialDocumentId,

            updatedAt:
              timestamp
          }
        }
      });
    }
  );

  if (
    transactItems.length >
      100
  ) {
    throw new Error(
      `Financial create transaction exceeds DynamoDB limit: ${transactItems.length}`
    );
  }

  await client.send(
    new TransactWriteCommand({
      TransactItems:
        transactItems
    })
  );

  return source;
}


async function replaceDocumentRecord({
  record,
  previousRecord,
  passportIds = [],
  previousPassportIds = [],
  idempotencyKey = "",
  commandId = "",
  actorPassportId = ""
} = {}) {
  const source =
    safeObject(
      record
    );

  const financialDocumentId =
    clean(
      source
        ?.financialDocument
        ?.financialDocumentId
    );

  if (!financialDocumentId) {
    throw new Error(
      "financialDocumentId is required."
    );
  }

  const revision =
    Number(
      source
        ?.server
        ?.revision ||
      0
    );

  const previousRevision =
    Number(
      previousRecord
        ?.server
        ?.revision ||
      0
    );

  if (
    revision !==
      previousRevision + 1
  ) {
    throw new Error(
      `Invalid financial revision progression: ${previousRevision} -> ${revision}`
    );
  }

  const timestamp =
    clean(
      source
        ?.server
        ?.updatedAt
    ) ||
    nowIso();



  const entityPassportId =
    clean(
      source
        ?.server
        ?.entityPassportId
    );


  const previousEntityPassportId =
    clean(
      previousRecord
        ?.server
        ?.entityPassportId
    );


  if (!entityPassportId) {
    throw new Error(
      "Financial document requires server.entityPassportId."
    );
  }


  /*
   * Financial Document ownership is immutable.
   *
   * Moving accounting history between companies
   * is not a document revision.
   */
  if (
    previousEntityPassportId &&
    previousEntityPassportId !==
      entityPassportId
  ) {
    throw new Error(
      `Financial document Entity ownership cannot change: ${previousEntityPassportId} -> ${entityPassportId}`
    );
  }

  const historyRecord = {
    historyId:
      `ifh_${randomId()}`,

    financialDocumentId,

    revision,

    operation:
      "replace",

    actorPassportId:
      clean(
        actorPassportId
      ),

    commandId:
      clean(
        commandId
      ),

    recordedAt:
      timestamp,

    record:
      source
  };

  const transactItems = [
    {
      Put: {
        TableName:
          TABLE_NAME,

        Item: {
          PK:
            documentPk(
              financialDocumentId
            ),

          SK:
            "CURRENT",

          entityType:
            "financial-document-current",

          financialDocumentId,

          revision,

          updatedAt:
            timestamp,

          record:
            source
        },

        ConditionExpression:
          "#revision = :expectedRevision",

        ExpressionAttributeNames: {
          "#revision":
            "revision"
        },

        ExpressionAttributeValues: {
          ":expectedRevision":
            previousRevision
        }
      }
    },

    {
      Put: {
        TableName:
          TABLE_NAME,

        Item: {
          PK:
            documentPk(
              financialDocumentId
            ),

          SK:
            revisionSk(
              revision
            ),

          entityType:
            "financial-document-revision",

          financialDocumentId,

          revision,

          recordedAt:
            timestamp,

          historyRecord
        },

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    }
  ];

  transactItems.push({
    Put: {
      TableName:
        TABLE_NAME,

      Item: {
        PK:
          entityPk(
            entityPassportId
          ),

        SK:
          `DOC#${financialDocumentId}`,

        entityType:
          "financial-entity-index",

        entityPassportId,

        financialDocumentId,

        updatedAt:
          timestamp
      }
    }
  });


  const oldPassports =
    new Set(
      safeArray(
        previousPassportIds
      )
        .map(clean)
        .filter(Boolean)
    );

  const newPassports =
    new Set(
      safeArray(
        passportIds
      )
        .map(clean)
        .filter(Boolean)
    );

  oldPassports.forEach(
    passportId => {
      if (
        newPassports.has(
          passportId
        )
      ) {
        return;
      }

      transactItems.push({
        Delete: {
          TableName:
            TABLE_NAME,

          Key: {
            PK:
              passportPk(
                passportId
              ),

            SK:
              `DOC#${financialDocumentId}`
          }
        }
      });
    }
  );

  newPassports.forEach(
    passportId => {
      transactItems.push({
        Put: {
          TableName:
            TABLE_NAME,

          Item: {
            PK:
              passportPk(
                passportId
              ),

            SK:
              `DOC#${financialDocumentId}`,

            GSI1PK:
              `DOC#${financialDocumentId}`,

            GSI1SK:
              `PASS#${passportId}`,

            entityType:
              "financial-passport-index",

            passportId,

            financialDocumentId,

            updatedAt:
              timestamp
          }
        }
      });
    }
  );

  const idem =
    clean(
      idempotencyKey
    );

  if (idem) {
    transactItems.push({
      Put: {
        TableName:
          TABLE_NAME,

        Item: {
          PK:
            idempotencyPk(idem),

          SK:
            "RESULT",

          entityType:
            "financial-idempotency",

          idempotencyRecord: {
            idempotencyKey:
              idem,

            operation:
              "replace",

            financialDocumentId,

            revision,

            completedAt:
              timestamp
          }
        },

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    });
  }

  if (
    transactItems.length >
      100
  ) {
    throw new Error(
      `Financial replace transaction exceeds DynamoDB limit: ${transactItems.length}`
    );
  }

  await client.send(
    new TransactWriteCommand({
      TransactItems:
        transactItems
    })
  );

  return source;
}


async function appendAuditEvent(
  event
) {
  const source =
    safeObject(
      event
    );

  const financialDocumentId =
    clean(
      source
        .financialDocumentId
    );

  const financialAuditId =
    clean(
      source
        .financialAuditId
    );

  if (
    !financialDocumentId ||
    !financialAuditId
  ) {
    throw new Error(
      "financialDocumentId and financialAuditId are required."
    );
  }

  const occurredAt =
    clean(
      source.occurredAt
    ) ||
    nowIso();

  await client.send(
    new PutCommand({
      TableName:
        TABLE_NAME,

      Item: {
        PK:
          documentPk(
            financialDocumentId
          ),

        SK:
          `AUDIT#${occurredAt}#${financialAuditId}`,

        entityType:
          "financial-audit",

        financialDocumentId,

        financialAuditId,

        occurredAt,

        event:
          source
      },

      ConditionExpression:
        "attribute_not_exists(PK)"
    })
  );

  return source;
}


async function getAuditEvents(
  financialDocumentId
) {
  const id =
    clean(
      financialDocumentId
    );

  if (!id) {
    return [];
  }

  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          "PK = :pk AND begins_with(SK, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            documentPk(id),

          ":prefix":
            "AUDIT#"
        },

        ConsistentRead:
          true,

        ScanIndexForward:
          true
      })
    );

  return safeArray(
    result.Items
  )
    .map(
      item =>
        item.event
    )
    .filter(Boolean);
}


async function getFinancialAccount(
  entityPassportId,
  accountCode
) {
  const entityId =
    clean(
      entityPassportId
    );

  const code =
    clean(
      accountCode
    );


  if (
    !entityId ||
    !code
  ) {
    return null;
  }


  const result =
    await client.send(
      new GetCommand({
        TableName:
          TABLE_NAME,

        Key: {
          PK:
            entityPk(
              entityId
            ),

          SK:
            accountSk(
              code
            )
        },

        ConsistentRead:
          true
      })
    );


  return result.Item
    ?.account ||
    null;
}


async function listFinancialAccounts(
  entityPassportId
) {
  const entityId =
    clean(
      entityPassportId
    );


  if (!entityId) {
    return [];
  }


  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          "PK = :pk AND begins_with(SK, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            entityPk(
              entityId
            ),

          ":prefix":
            "ACCOUNT#"
        },

        ConsistentRead:
          true,

        ScanIndexForward:
          true
      })
    );


  return safeArray(
    result.Items
  )
    .map(
      item =>
        item.account
    )
    .filter(Boolean)
    .sort(
      (
        a,
        b
      ) =>
        clean(
          a.accountCode
        ).localeCompare(
          clean(
            b.accountCode
          )
        )
    );
}


async function putFinancialAccount({
  entityPassportId = "",
  account = {}
} = {}) {
  const entityId =
    clean(
      entityPassportId
    );

  const source =
    (
      account &&
      typeof account === "object" &&
      !Array.isArray(account)
    )
      ? account
      : {};


  const accountCode =
    clean(
      source.accountCode ||
      source.code
    );


  if (!entityId) {
    throw new Error(
      "Financial account requires entityPassportId."
    );
  }


  if (!accountCode) {
    throw new Error(
      "Financial account requires accountCode."
    );
  }


  const timestamp =
    nowIso();


  const record = {
    entityPassportId:
      entityId,

    accountCode,

    accountName:
      clean(
        source.accountName ||
        source.name
      ),

    accountType:
      clean(
        source.accountType ||
        source.type
      ).toLowerCase(),

    control:
      clean(
        source.control
      ).toLowerCase(),

    active:
      source.active !==
        false,

    system:
      source.system ===
        true,

    metadata:
      (
        source.metadata &&
        typeof source.metadata === "object" &&
        !Array.isArray(source.metadata)
      )
        ? source.metadata
        : {},

    createdAt:
      clean(
        source.createdAt
      ) ||
      timestamp,

    updatedAt:
      timestamp
  };


  await client.send(
    new PutCommand({
      TableName:
        TABLE_NAME,

      Item: {
        PK:
          entityPk(
            entityId
          ),

        SK:
          accountSk(
            accountCode
          ),

        entityType:
          "financial-account",

        entityPassportId:
          entityId,

        accountCode,

        updatedAt:
          timestamp,

        account:
          record
      }
    })
  );


  return record;
}


async function getDynamoFinancialHealth() {
  await client.send(
    new GetCommand({
      TableName:
        TABLE_NAME,

      Key: {
        PK:
          "__IXI_FINANCIAL_HEALTH__",

        SK:
          "__HEALTH__"
      },

      ConsistentRead:
        true
    })
  );

  return {
    provider:
      "dynamodb",

    region:
      REGION,

    tableName:
      TABLE_NAME,

    reachable:
      true
  };
}


module.exports = {
  REGION,
  TABLE_NAME,

  getCurrentDocumentRecord,
  getFinancialDocumentHistory,

  getIdempotencyRecord,

  getPassportDocumentIds,
  getEntityDocumentIds,
  getDocumentPassportIds,

  getFinancialAccount,
  listFinancialAccounts,
  putFinancialAccount,

  createDocumentRecord,
  replaceDocumentRecord,

  appendAuditEvent,
  getAuditEvents,

  getDynamoFinancialHealth
};
