"use strict";

const crypto = require("crypto");

const {
  DynamoDBClient
} = require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand
} = require("@aws-sdk/lib-dynamodb");

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
    new DynamoDBClient({ region: REGION }),
    {
      marshallOptions: {
        removeUndefinedValues: true
      }
    }
  );

function createEventId() {
  return (
    "FEVT-" +
    crypto.randomUUID().toUpperCase()
  );
}

function buildFreightEvent({
  entityId,
  freightOrderId,
  eventType,
  actorId = "",
  commandId = "",
  payload = {},
  occurredAt = nowIso(),
  eventId = createEventId()
}) {
  return {
    eventId: clean(eventId),
    entityId: clean(entityId),
    freightOrderId: clean(freightOrderId),
    eventType: clean(eventType),
    actorId: clean(actorId),
    commandId: clean(commandId),
    occurredAt: clean(occurredAt),
    payload:
      payload && typeof payload === "object"
        ? payload
        : {}
  };
}

function freightEventItem(event) {
  return {
    pk: `FREIGHT#${event.freightOrderId}`,
    sk: `EVENT#${event.occurredAt}#${event.eventId}`,
    recordType: "freight-event",
    entityId: event.entityId,
    freightOrderId: event.freightOrderId,
    createdAt: event.occurredAt,
    event
  };
}

async function appendFreightEvent({
  entityId,
  freightOrderId,
  eventType,
  actorId = "",
  commandId = "",
  payload = {}
}) {
  const event = buildFreightEvent({
    entityId,
    freightOrderId,
    eventType,
    actorId,
    commandId,
    payload
  });

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,

      Item: freightEventItem(event),

      ConditionExpression:
        "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    })
  );

  return event;
}

async function listFreightEvents({
  freightOrderId,
  limit = 200
}) {
  const result =
    await client.send(
      new QueryCommand({
        TableName:
          TABLE_NAME,

        KeyConditionExpression:
          "pk = :pk AND begins_with(sk, :prefix)",

        ExpressionAttributeValues: {
          ":pk":
            `FREIGHT#${clean(freightOrderId)}`,

          ":prefix":
            "EVENT#"
        },

        ScanIndexForward:
          true,

        Limit:
          Math.min(
            500,
            Math.max(
              1,
              Number(limit) || 200
            )
          )
      })
    );

  return (
    result.Items || []
  ).map(
    item => item.event
  );
}

module.exports = {
  buildFreightEvent,
  freightEventItem,
  appendFreightEvent,
  listFreightEvents
};
