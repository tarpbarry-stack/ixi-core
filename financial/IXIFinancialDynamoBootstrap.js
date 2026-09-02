"use strict";

const {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  waitUntilTableExists
} = require("@aws-sdk/client-dynamodb");


const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-2";


const TABLE =
  process.env.IXI_FINANCIAL_DDB_TABLE ||
  "ixi-financial-v1";


const client =
  new DynamoDBClient({
    region:
      REGION
  });


(async () => {

  console.log(
    "AWS REGION:",
    REGION
  );


  console.log(
    "FINANCIAL TABLE:",
    TABLE
  );


  let exists =
    false;


  try {

    const existing =
      await client.send(
        new DescribeTableCommand({
          TableName:
            TABLE
        })
      );


    exists =
      true;


    console.log(
      "DYNAMODB TABLE ALREADY EXISTS:",
      existing
        .Table
        ?.TableStatus
    );

  } catch (
    error
  ) {

    if (
      error?.name !==
        "ResourceNotFoundException"
    ) {
      throw error;
    }
  }


  if (
    !exists
  ) {

    console.log(
      "CREATING DYNAMODB TABLE..."
    );


    await client.send(
      new CreateTableCommand({
        TableName:
          TABLE,

        BillingMode:
          "PAY_PER_REQUEST",

        AttributeDefinitions: [
          {
            AttributeName:
              "PK",

            AttributeType:
              "S"
          },

          {
            AttributeName:
              "SK",

            AttributeType:
              "S"
          },

          {
            AttributeName:
              "GSI1PK",

            AttributeType:
              "S"
          },

          {
            AttributeName:
              "GSI1SK",

            AttributeType:
              "S"
          }
        ],

        KeySchema: [
          {
            AttributeName:
              "PK",

            KeyType:
              "HASH"
          },

          {
            AttributeName:
              "SK",

            KeyType:
              "RANGE"
          }
        ],

        GlobalSecondaryIndexes: [
          {
            IndexName:
              "GSI1",

            KeySchema: [
              {
                AttributeName:
                  "GSI1PK",

                KeyType:
                  "HASH"
              },

              {
                AttributeName:
                  "GSI1SK",

                KeyType:
                  "RANGE"
              }
            ],

            Projection: {
              ProjectionType:
                "ALL"
            }
          }
        ]
      })
    );


    console.log(
      "WAITING FOR TABLE..."
    );


    const waiter =
      await waitUntilTableExists(
        {
          client,

          maxWaitTime:
            120
        },
        {
          TableName:
            TABLE
        }
      );


    console.log(
      "TABLE WAITER STATE:",
      waiter.state
    );
  }


  const result =
    await client.send(
      new DescribeTableCommand({
        TableName:
          TABLE
      })
    );


  const table =
    result.Table ||
    {};


  const summary = {
    TableName:
      table.TableName,

    Status:
      table.TableStatus,

    BillingMode:
      table
        .BillingModeSummary
        ?.BillingMode ||
      "PAY_PER_REQUEST",

    ItemCount:
      table.ItemCount,

    Arn:
      table.TableArn,

    Indexes:
      (
        table
          .GlobalSecondaryIndexes ||
        []
      ).map(
        index =>
          index.IndexName
      )
  };


  console.dir(
    summary,
    {
      depth:
        null
    }
  );


  if (
    table.TableStatus !==
      "ACTIVE"
  ) {

    throw new Error(
      `Financial DynamoDB table is not ACTIVE: ${table.TableStatus}`
    );
  }


  if (
    !(
      table
        .GlobalSecondaryIndexes ||
      []
    ).some(
      index =>
        index.IndexName ===
          "GSI1"
    )
  ) {

    throw new Error(
      "Financial DynamoDB table is missing GSI1."
    );
  }


  console.log(
    "IXI FINANCIAL DYNAMODB TABLE: GREEN"
  );

})().catch(
  error => {

    console.error(
      "IXI FINANCIAL DYNAMODB TABLE: FAILED"
    );


    console.error(
      "NAME:",
      error?.name
    );


    console.error(
      "MESSAGE:",
      error?.message
    );


    if (
      error?.$metadata
    ) {

      console.error(
        "AWS METADATA:",
        error.$metadata
      );
    }


    process.exit(1);
  }
);
