require("dotenv").config();

const {
  SQSClient,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand
} = require("@aws-sdk/client-sqs");

const {
  REGION,
  QUEUE_NAME
} = require("../config/mediaConfig");

const {
  processMediaJob
} = require("./processMediaJob");

const {
  writeWorkerHeartbeat
} = require("../system/workerHeartbeat");

const sqs = new SQSClient({
  region: REGION
});

const VISIBILITY_TIMEOUT_SECONDS = 600;
const HEARTBEAT_INTERVAL_MS = 120000;

let queueUrl = "";
let shuttingDown = false;

const workerStartedAt =
  new Date().toISOString();

let activeJobId = "";
let lastCompletedJobId = "";
let lastFailedJobId = "";
let lastError = "";
let jobsCompleted = 0;
let jobsFailed = 0;
let heartbeatTimer = null;

async function reportHeartbeat(
  status = "online"
) {
  try {
    await writeWorkerHeartbeat({
      status,
      activeJobId,
      lastCompletedJobId,
      lastFailedJobId,
      lastError,
      jobsCompleted,
      jobsFailed,
      startedAt:
        workerStartedAt
    });
  } catch (error) {
    console.error(
      "IXI MEDIA WORKER HEARTBEAT WRITE FAILED:",
      error?.message || error
    );
  }
}

function startWorkerHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(
      heartbeatTimer
    );
  }

  heartbeatTimer =
    setInterval(
      () => {
        reportHeartbeat(
          shuttingDown
            ? "stopping"
            : "online"
        );
      },
      30000
    );
}

async function resolveQueueUrl() {
  if (queueUrl) {
    return queueUrl;
  }

  const response = await sqs.send(
    new GetQueueUrlCommand({
      QueueName: QUEUE_NAME
    })
  );

  if (!response.QueueUrl) {
    throw new Error(
      "IXI media worker could not resolve queue URL"
    );
  }

  queueUrl = response.QueueUrl;

  return queueUrl;
}

async function deleteMessage(message) {
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle
    })
  );
}

function startVisibilityHeartbeat(message) {
  return setInterval(async () => {
    try {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout:
            VISIBILITY_TIMEOUT_SECONDS
        })
      );

      console.log(
        "IXI MEDIA WORKER: message visibility extended"
      );
    } catch (error) {
      console.error(
        "IXI MEDIA WORKER HEARTBEAT FAILED:",
        error?.message || error
      );
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function processMessage(message) {
  let job;

  try {
    job = JSON.parse(message.Body);
  } catch {
    /*
     * Invalid JSON can never succeed on retry.
     * Delete it rather than allowing an endless poison-message loop.
     */
    console.error(
      "IXI MEDIA WORKER: invalid JSON message deleted"
    );

    await deleteMessage(message);
    return;
  }

  console.log(
    `IXI MEDIA WORKER: received ${
      job.jobId || "unknown job"
    }`
  );

  activeJobId =
    String(
      job.jobId || ""
    );

  lastError = "";

  await reportHeartbeat(
    "processing"
  );

  const heartbeat =
    startVisibilityHeartbeat(message);

  try {
    const result =
      await processMediaJob(job);

    await deleteMessage(message);

    lastCompletedJobId =
      String(
        result.jobId || ""
      );

    jobsCompleted += 1;

    activeJobId = "";

    await reportHeartbeat(
      "online"
    );

    console.log(
      `IXI MEDIA WORKER: completed ${result.jobId} — ${result.status}`
    );
  } catch (error) {
    /*
     * Do not delete a processing failure.
     * SQS will retry it and move it to the DLQ after the configured
     * maximum receive count.
     */
    lastFailedJobId =
      String(
        job.jobId || ""
      );

    lastError =
      String(
        error?.message ||
        error ||
        "Unknown worker error"
      );

    jobsFailed += 1;

    activeJobId = "";

    await reportHeartbeat(
      "online"
    );

    console.error(
      `IXI MEDIA WORKER: job failed ${
        job.jobId || "unknown"
      }:`,
      error?.message || error
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function pollOnce() {
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout:
        VISIBILITY_TIMEOUT_SECONDS,

      AttributeNames: [
        "ApproximateReceiveCount"
      ],

      MessageAttributeNames: [
        "All"
      ]
    })
  );

  const messages =
    response.Messages || [];

  for (const message of messages) {
    const receiveCount =
      message.Attributes?.ApproximateReceiveCount ||
      "1";

    console.log(
      `IXI MEDIA WORKER: receive attempt ${receiveCount}`
    );

    await processMessage(message);
  }
}

async function run() {
  await resolveQueueUrl();

  console.log(
    "IXI MEDIA WORKER ONLINE"
  );

  console.log(
    `Region: ${REGION}`
  );

  console.log(
    `Queue: ${QUEUE_NAME}`
  );

  await reportHeartbeat(
    "online"
  );

  startWorkerHeartbeat();

  while (!shuttingDown) {
    try {
      await pollOnce();
    } catch (error) {
      console.error(
        "IXI MEDIA WORKER POLL FAILED:",
        error?.message || error
      );

      await new Promise(resolve =>
        setTimeout(resolve, 5000)
      );
    }
  }

  if (heartbeatTimer) {
    clearInterval(
      heartbeatTimer
    );
  }

  await reportHeartbeat(
    "offline"
  );

  console.log(
    "IXI MEDIA WORKER STOPPED"
  );
}

function requestShutdown(signal) {
  console.log(
    `IXI MEDIA WORKER: ${signal} received`
  );

  shuttingDown = true;
}

process.on(
  "SIGTERM",
  () => requestShutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => requestShutdown("SIGINT")
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "IXI MEDIA WORKER UNHANDLED REJECTION:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "IXI MEDIA WORKER UNCAUGHT EXCEPTION:",
      error
    );

    process.exit(1);
  }
);

run().catch(error => {
  console.error(
    "IXI MEDIA WORKER START FAILED:",
    error
  );

  process.exit(1);
});
