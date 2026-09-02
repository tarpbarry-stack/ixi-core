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
  QueryCommand,
  TransactWriteCommand
} =
  require("@aws-sdk/lib-dynamodb");


const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-2";


const TABLE_NAME =
  process.env.IXI_AUTHORITY_DDB_TABLE ||
  "ixi-aos-authority-v1";


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


function nowIso() {
  return new Date()
    .toISOString();
}


function randomId() {
  return crypto
    .randomBytes(12)
    .toString("hex");
}


function policyPk(
  passportId
) {
  return `POLICY#${clean(
    passportId
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


async function getCurrentPolicyRecord(
  passportId
) {
  const id =
    clean(
      passportId
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
            policyPk(id),

          SK:
            "CURRENT"
        },

        ConsistentRead:
          true
      })
    );


  return result.Item ||
    null;
}


async function getPolicyHistory(
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
            policyPk(id),

          ":prefix":
            "REV#"
        },

        ConsistentRead:
          true,

        ScanIndexForward:
          true
      })
    );


  return (
    result.Items ||
    []
  );
}


async function putPolicyRecord({
  policy,
  previousRecord = null,
  actorId = ""
} = {}) {
  const targetPassportId =
    clean(
      policy
        ?.target
        ?.passportId
    );


  if (!targetPassportId) {
    throw new Error(
      "Authority target Passport ID is required."
    );
  }


  const previousRevision =
    Number(
      previousRecord
        ?.revision ||
      0
    );


  const revision =
    previousRevision + 1;


  const timestamp =
    nowIso();


  const currentItem = {
    PK:
      policyPk(
        targetPassportId
      ),

    SK:
      "CURRENT",

    entityType:
      "ixi-authority-policy-current",

    targetPassportId,

    policyId:
      clean(
        policy.policyId
      ),

    revision,

    updatedAt:
      timestamp,

    updatedBy:
      clean(
        actorId
      ),

    policy
  };


  const revisionItem = {
    PK:
      policyPk(
        targetPassportId
      ),

    SK:
      revisionSk(
        revision
      ),

    entityType:
      "ixi-authority-policy-revision",

    targetPassportId,

    policyId:
      clean(
        policy.policyId
      ),

    revision,

    recordedAt:
      timestamp,

    recordedBy:
      clean(
        actorId
      ),

    policy
  };


  const auditItem = {
    PK:
      `AUDIT#${clean(
        policy.policyId
      )}`,

    SK:
      `EVENT#${timestamp}#${randomId()}`,

    entityType:
      "ixi-authority-audit-event",

    event: {
      eventId:
        `auth_evt_${randomId()}`,

      operation:
        previousRecord
          ? "replace-policy"
          : "create-policy",

      targetPassportId,

      policyId:
        clean(
          policy.policyId
        ),

      revision,

      actorId:
        clean(
          actorId
        ),

      occurredAt:
        timestamp
    }
  };


  const transactItems = [
    {
      Put: {
        TableName:
          TABLE_NAME,

        Item:
          currentItem,

        ...(
          previousRecord
            ? {
                ConditionExpression:
                  "revision = :expectedRevision",

                ExpressionAttributeValues: {
                  ":expectedRevision":
                    previousRevision
                }
              }
            : {
                ConditionExpression:
                  "attribute_not_exists(PK)"
              }
        )
      }
    },

    {
      Put: {
        TableName:
          TABLE_NAME,

        Item:
          revisionItem,

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    },

    {
      Put: {
        TableName:
          TABLE_NAME,

        Item:
          auditItem,

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    }
  ];


  await client.send(
    new TransactWriteCommand({
      TransactItems:
        transactItems
    })
  );


  return {
    ...currentItem
  };
}


async function getAuthorityHealth() {
  await client.send(
    new GetCommand({
      TableName:
        TABLE_NAME,

      Key: {
        PK:
          "__IXI_AUTHORITY_HEALTH__",

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

  getCurrentPolicyRecord,
  getPolicyHistory,
  putPolicyRecord,

  getAuthorityHealth
};
