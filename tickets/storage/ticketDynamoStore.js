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
  QueryCommand,
  UpdateCommand
} = require(
  "@aws-sdk/lib-dynamodb"
);

const {
  TicketError
} = require("../TicketError");

const {
  clean,
  nowIso
} = require("../util");

const {
  normalizeTicket
} = require(
  "../contracts/ticketContract"
);

const TABLE_NAME =
  process.env.IXI_TICKET_TABLE ||
  "IXITickets";

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

function ticketPk(
  entityId
) {
  return (
    `ENTITY#${clean(entityId)}`
  );
}

function ticketSk(
  ticketId
) {
  return (
    `TICKET#${clean(ticketId)}`
  );
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

function repoIndexPk(
  repository
) {
  return (
    `REPOSITORY#${clean(repository)}`
  );
}

function indexSortKey(
  updatedAt,
  ticketId
) {
  return (
    `${clean(updatedAt)}` +
    `#${clean(ticketId)}`
  );
}

function dateKey(
  date = new Date()
) {
  const yy =
    String(
      date.getUTCFullYear()
    ).slice(-2);

  const mm =
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0");

  const dd =
    String(
      date.getUTCDate()
    ).padStart(2, "0");

  return `${yy}${mm}${dd}`;
}

async function reserveTicketNumber({
  prefix = "CT"
} = {}) {
  const day =
    dateKey();

  const result =
    await client.send(
      new UpdateCommand({
        TableName:
          TABLE_NAME,

        Key: {
          pk:
            `COUNTER#TICKET#${day}`,

          sk:
            "COUNTER"
        },

        UpdateExpression:
          [
            "SET #value = if_not_exists(#value, :zero) + :one",
            "#updatedAt = :updatedAt"
          ].join(", "),

        ExpressionAttributeNames: {
          "#value":
            "value",

          "#updatedAt":
            "updatedAt"
        },

        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":updatedAt":
            nowIso()
        },

        ReturnValues:
          "UPDATED_NEW"
      })
    );

  const sequence =
    Number(
      result.Attributes?.value ||
      0
    );

  if (!sequence) {
    throw new TicketError(
      "TICKET_NUMBER_RESERVATION_FAILED",
      "Ticket number could not be reserved.",
      {},
      500
    );
  }

  return {
    displayNumber:
      `${clean(prefix) || "CT"}-${day}-${String(sequence).padStart(6, "0")}`,

    sequence,
    day
  };
}

function toItem(
  record,
  revision
) {
  const ticket =
    normalizeTicket(record);

  const entityId =
    clean(
      ticket.authority
        ?.entityId
    );

  if (!entityId) {
    throw new TicketError(
      "TICKET_ENTITY_REQUIRED",
      "Ticket persistence requires Entity identity.",
      {},
      400
    );
  }

  const updatedAt =
    clean(
      ticket.audit?.updatedAt
    ) || nowIso();

  return {
    pk:
      ticketPk(entityId),

    sk:
      ticketSk(
        ticket.ticketId
      ),

    recordType:
      "ixi-ticket",

    entityId,

    ticketId:
      ticket.ticketId,

    displayNumber:
      ticket.displayNumber,

    status:
      ticket.status,

    repository:
      ticket.repository,

    source:
      ticket.source,

    type:
      ticket.type,

    priority:
      ticket.priority,

    executionClass:
      ticket.executionClass,

    actorPassportId:
      ticket.authority
        ?.actorPassportId ||
      "",

    entityPassportId:
      ticket.authority
        ?.entityPassportId ||
      "",

    createdAt:
      ticket.audit
        ?.createdAt ||
      updatedAt,

    updatedAt,

    revision:
      Number(revision),

    gsi1pk:
      statusIndexPk(
        entityId,
        ticket.status
      ),

    gsi1sk:
      indexSortKey(
        updatedAt,
        ticket.ticketId
      ),

    gsi2pk:
      repoIndexPk(
        ticket.repository
      ),

    gsi2sk:
      indexSortKey(
        updatedAt,
        ticket.ticketId
      ),

    ticket
  };
}

function fromItem(
  item
) {
  if (!item) {
    return null;
  }

  return {
    ...normalizeTicket(
      item.ticket
    ),

    revision:
      Number(
        item.revision ||
        1
      )
  };
}

async function createTicketRecord(
  record
) {
  const item =
    toItem(
      record,
      1
    );

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
      throw new TicketError(
        "TICKET_ALREADY_EXISTS",
        "Ticket already exists.",
        {
          ticketId:
            record.ticketId
        },
        409
      );
    }

    throw error;
  }

  return fromItem(item);
}

async function replaceTicketRecord({
  record,
  expectedRevision
}) {
  const nextRevision =
    Number(
      expectedRevision
    ) + 1;

  const item =
    toItem(
      {
        ...record,

        audit: {
          ...(record.audit || {}),

          updatedAt:
            nowIso()
        }
      },
      nextRevision
    );

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
      throw new TicketError(
        "TICKET_REVISION_CONFLICT",
        "Ticket changed before this update could be committed.",
        {
          ticketId:
            record.ticketId,

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

  return fromItem(item);
}

async function getTicketRecord({
  entityId,
  ticketId
}) {
  const result =
    await client.send(
      new GetCommand({
        TableName:
          TABLE_NAME,

        Key: {
          pk:
            ticketPk(
              entityId
            ),

          sk:
            ticketSk(
              ticketId
            )
        },

        ConsistentRead:
          true
      })
    );

  return fromItem(
    result.Item
  );
}

async function listTicketsByStatus({
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
          "gsi1",

        KeyConditionExpression:
          "gsi1pk = :pk",

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
              Number(limit) || 100
            )
          )
      })
    );

  return (
    result.Items || []
  ).map(
    fromItem
  );
}

async function listTicketsByRepository({
  repository,
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
            repoIndexPk(
              repository
            )
        },

        ScanIndexForward:
          false,

        Limit:
          Math.min(
            250,
            Math.max(
              1,
              Number(limit) || 100
            )
          )
      })
    );

  return (
    result.Items || []
  ).map(
    fromItem
  );
}

function describeTicketStore() {
  return {
    provider:
      "dynamodb",

    tableName:
      TABLE_NAME,

    region:
      REGION,

    schema:
      "ixi-ticket-dynamo-v1",

    primaryKey:
      "pk + sk",

    indexes: [
      "gsi1 entity/status queue",
      "gsi2 repository queue"
    ],

    concurrency:
      "optimistic revision",

    numbering:
      "atomic daily counter"
  };
}

module.exports = {
  TABLE_NAME,
  REGION,

  reserveTicketNumber,

  createTicketRecord,
  replaceTicketRecord,
  getTicketRecord,

  listTicketsByStatus,
  listTicketsByRepository,

  describeTicketStore
};
