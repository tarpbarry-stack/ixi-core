"use strict";

const {
  DynamoDBClient
} =
  require(
    "@aws-sdk/client-dynamodb"
  );


const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand
} =
  require(
    "@aws-sdk/lib-dynamodb"
  );


const {
  REGION,
  TABLE_NAME
} =
  require(
    "./IXIIdentityConstants"
  );


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


function identityPk(
  cognitoSubject
) {
  return `IDENTITY#${clean(
    cognitoSubject
  )}`;
}


function employeePk(
  employeeId
) {
  return `EMPLOYEE#${clean(
    employeeId
  )}`;
}


function entityPk(
  entityId
) {
  return `ENTITY#${clean(
    entityId
  )}`;
}


function invitePk(
  invitationId
) {
  return `INVITE#${clean(
    invitationId
  )}`;
}


function invitationEmailGuardPk({
  entityId,
  emailHash
}) {
  return [
    "INVITEEMAIL",
    clean(entityId),
    clean(emailHash)
  ].join("#");
}


function membershipSk(
  entityId
) {
  return `MEMBERSHIP#${clean(
    entityId
  )}`;
}


async function getItem(
  key,
  {
    consistentRead = true
  } = {}
) {
  const result =
    await client.send(
      new GetCommand({
        TableName:
          TABLE_NAME,

        Key:
          key,

        ConsistentRead:
          Boolean(
            consistentRead
          )
      })
    );

  return result.Item ||
    null;
}


async function putItem({
  item,
  conditionExpression,
  expressionAttributeNames,
  expressionAttributeValues
} = {}) {
  const input = {
    TableName:
      TABLE_NAME,

    Item:
      item
  };

  if (conditionExpression) {
    input.ConditionExpression =
      conditionExpression;
  }

  if (expressionAttributeNames) {
    input.ExpressionAttributeNames =
      expressionAttributeNames;
  }

  if (expressionAttributeValues) {
    input.ExpressionAttributeValues =
      expressionAttributeValues;
  }

  await client.send(
    new PutCommand(
      input
    )
  );

  return item;
}


async function updateItem({
  key,
  updateExpression,
  conditionExpression,
  expressionAttributeNames,
  expressionAttributeValues
} = {}) {
  const result =
    await client.send(
      new UpdateCommand({
        TableName:
          TABLE_NAME,

        Key:
          key,

        UpdateExpression:
          updateExpression,

        ConditionExpression:
          conditionExpression,

        ExpressionAttributeNames:
          expressionAttributeNames,

        ExpressionAttributeValues:
          expressionAttributeValues,

        ReturnValues:
          "ALL_NEW"
      })
    );

  return result.Attributes ||
    null;
}


async function queryByPk(
  pk,
  {
    skPrefix = "",
    scanForward = true
  } = {}
) {
  const values = {
    ":pk":
      clean(pk)
  };

  let expression =
    "PK = :pk";

  if (clean(skPrefix)) {
    values[":skPrefix"] =
      clean(skPrefix);

    expression +=
      " AND begins_with(SK, :skPrefix)";
  }

  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          expression,

        ExpressionAttributeValues:
          values,

        ConsistentRead:
          true,

        ScanIndexForward:
          Boolean(
            scanForward
          )
      })
    );

  return safeArray(
    result.Items
  );
}


async function queryIndex({
  indexName,
  partitionKeyName,
  partitionKeyValue,
  sortKeyName,
  sortKeyPrefix = "",
  scanForward = true
} = {}) {
  const values = {
    ":pk":
      clean(
        partitionKeyValue
      )
  };

  let expression =
    `${partitionKeyName} = :pk`;

  if (
    clean(sortKeyPrefix)
  ) {
    values[":skPrefix"] =
      clean(
        sortKeyPrefix
      );

    expression +=
      ` AND begins_with(${sortKeyName}, :skPrefix)`;
  }

  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        IndexName:
          indexName,

        KeyConditionExpression:
          expression,

        ExpressionAttributeValues:
          values,

        ScanIndexForward:
          Boolean(
            scanForward
          )
      })
    );

  return safeArray(
    result.Items
  );
}


async function queryGsi1(
  partitionKeyValue,
  options = {}
) {
  return queryIndex({
    indexName:
      "GSI1",

    partitionKeyName:
      "GSI1PK",

    partitionKeyValue,

    sortKeyName:
      "GSI1SK",

    sortKeyPrefix:
      options.sortKeyPrefix,

    scanForward:
      options.scanForward
  });
}


async function queryGsi2(
  partitionKeyValue,
  options = {}
) {
  return queryIndex({
    indexName:
      "GSI2",

    partitionKeyName:
      "GSI2PK",

    partitionKeyValue,

    sortKeyName:
      "GSI2SK",

    sortKeyPrefix:
      options.sortKeyPrefix,

    scanForward:
      options.scanForward
  });
}


async function transactWrite(
  transactItems = []
) {
  if (
    !Array.isArray(
      transactItems
    ) ||
    !transactItems.length
  ) {
    throw new Error(
      "Identity transaction requires at least one operation."
    );
  }

  if (
    transactItems.length >
      100
  ) {
    throw new Error(
      `Identity transaction exceeds DynamoDB limit: ${transactItems.length}`
    );
  }

  await client.send(
    new TransactWriteCommand({
      TransactItems:
        transactItems
    })
  );

  return true;
}


async function getDynamoIdentityHealth() {
  await client.send(
    new GetCommand({
      TableName:
        TABLE_NAME,

      Key: {
        PK:
          "__IXI_IDENTITY_HEALTH__",

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

  identityPk,
  employeePk,
  entityPk,
  invitePk,
  invitationEmailGuardPk,
  membershipSk,

  getItem,
  putItem,
  updateItem,

  queryByPk,
  queryGsi1,
  queryGsi2,

  transactWrite,

  getDynamoIdentityHealth
};
