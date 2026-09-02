"use strict";

const {
  DynamoDBClient
} = require(
  "@aws-sdk/client-dynamodb"
);

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand
} = require(
  "@aws-sdk/lib-dynamodb"
);

const {
  FreightError
} = require("../FreightError");

const {
  clean,
  nowIso
} = require("../util");

const TABLE_NAME =
  process.env.IXI_FREIGHT_TABLE ||
  "IXIFreight";

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-2";

const client =
  DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: REGION
    }),
    {
      marshallOptions: {
        removeUndefinedValues: true
      }
    }
  );

function orderPk(entityId) {
  return `ENTITY#${clean(entityId)}`;
}

function orderSk(freightOrderId) {
  return `FREIGHT#${clean(freightOrderId)}`;
}

function assetIndexPk(passportId) {
  return `ASSET#${clean(passportId)}`;
}

function statusIndexPk(
  entityId,
  status
) {
  return (
    `ENTITY#${clean(entityId)}` +
    `#STATUS#${clean(status)}`
  );
}

function toItem(record) {
  const entityId =
    clean(
      record?.entity?.entityId
    );

  const freightOrderId =
    clean(
      record
        ?.identity
        ?.freightOrderId
    );

  const passportId =
    clean(
      record
        ?.asset
        ?.passportId
    );

  if (
    !entityId ||
    !freightOrderId ||
    !passportId
  ) {
    throw new FreightError(
      "FREIGHT_PERSISTENCE_IDENTITY_REQUIRED",
      "Freight persistence requires Entity, Freight Order ID, and asset Passport.",
      {},
      400
    );
  }

  const timestamp =
    clean(
      record?.audit?.createdAt
    ) ||
    nowIso();

  return {
    pk:
      orderPk(entityId),

    sk:
      orderSk(freightOrderId),

    recordType:
      "freight-order",

    entityId,
    freightOrderId,
    assetPassportId:
      passportId,

    assetObjectId:
      clean(
        record
          ?.asset
          ?.objectId
      ),

    status:
      clean(record?.status),

    revision:
      Number(
        record
          ?.identity
          ?.revision ||
        0
      ),

    movementId:
      clean(
        record
          ?.movement
          ?.movementId
      ),

    carrierPassportId:
      clean(
        record
          ?.execution
          ?.carrierPassportId
      ),

    createdAt:
      timestamp,

    updatedAt:
      clean(
        record?.audit?.updatedAt
      ) ||
      timestamp,

    gsi1pk:
      assetIndexPk(
        passportId
      ),

    gsi1sk:
      `CREATED#${timestamp}`,

    gsi2pk:
      statusIndexPk(
        entityId,
        record.status
      ),

    gsi2sk:
      `UPDATED#${
        clean(
          record?.audit?.updatedAt
        ) ||
        timestamp
      }`,

    record
  };
}

async function createOrder(
  record
) {
  const item =
    toItem(record);

  try {
    await client.send(
      new PutCommand({
        TableName:
          TABLE_NAME,

        Item:
          item,

        ConditionExpression:
          "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      })
    );
  } catch (error) {
    if (
      error?.name ===
      "ConditionalCheckFailedException"
    ) {
      throw new FreightError(
        "FREIGHT_ALREADY_EXISTS",
        "Freight Order already exists.",
        {
          freightOrderId:
            item.freightOrderId
        },
        409
      );
    }

    throw error;
  }

  return record;
}

async function replaceOrder({
  record,
  expectedRevision
}) {
  const item =
    toItem(record);

  try {
    await client.send(
      new PutCommand({
        TableName:
          TABLE_NAME,

        Item:
          item,

        ConditionExpression:
          "attribute_exists(pk) AND attribute_exists(sk) AND revision = :expectedRevision",

        ExpressionAttributeValues: {
          ":expectedRevision":
            Number(
              expectedRevision
            )
        }
      })
    );
  } catch (error) {
    if (
      error?.name ===
      "ConditionalCheckFailedException"
    ) {
      throw new FreightError(
        "FREIGHT_REVISION_CONFLICT",
        "Freight Order changed before this command completed.",
        {
          freightOrderId:
            item.freightOrderId,

          expectedRevision:
            Number(
              expectedRevision
            )
        },
        409
      );
    }

    throw error;
  }

  return record;
}

async function getOrder({
  entityId,
  freightOrderId
}) {
  const result =
    await client.send(
      new GetCommand({
        TableName:
          TABLE_NAME,

        Key: {
          pk:
            orderPk(
              entityId
            ),

          sk:
            orderSk(
              freightOrderId
            )
        }
      })
    );

  return (
    result?.Item?.record ||
    null
  );
}

async function listOrdersForAsset({
  passportId,
  limit = 100
}) {
  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        IndexName:
          "gsi1",

        KeyConditionExpression:
          "gsi1pk = :pk",

        ExpressionAttributeValues: {
          ":pk":
            assetIndexPk(
              passportId
            )
        },

        ScanIndexForward:
          false,

        Limit:
          Math.min(
            250,
            Math.max(
              1,
              Number(limit) ||
              100
            )
          )
      })
    );

  return (
    result.Items || []
  ).map(
    item =>
      item.record
  );
}

async function listOrdersByStatus({
  entityId,
  status,
  limit = 100
}) {
  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        IndexName:
          "gsi2",

        KeyConditionExpression:
          "gsi2pk = :pk",

        ExpressionAttributeValues: {
          ":pk":
            statusIndexPk(
              entityId,
              status
            )
        },

        ScanIndexForward:
          false,

        Limit:
          Math.min(
            250,
            Math.max(
              1,
              Number(limit) ||
              100
            )
          )
      })
    );

  return (
    result.Items || []
  ).map(
    item =>
      item.record
  );
}

function describeFreightStore() {
  return {
    provider:
      "dynamodb",

    tableName:
      TABLE_NAME,

    region:
      REGION,

    schema:
      "ixi-freight-dynamo-v1",

    primaryKey:
      "pk + sk",

    indexes: [
      "gsi1 asset history",
      "gsi2 status queue"
    ]
  };
}

module.exports = {
  TABLE_NAME,
  REGION,

  createOrder,
  replaceOrder,
  getOrder,
  listOrdersForAsset,
  listOrdersByStatus,

  describeFreightStore
};
