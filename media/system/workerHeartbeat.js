const os = require("os");

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET,
  QUEUE_NAME
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

const WORKER_NAME =
  "IXI-Media-Worker";

const WORKER_VERSION =
  "1.0.0";

const HEARTBEAT_KEY =
  `system/worker-heartbeats/${WORKER_NAME}.json`;

function buildWorkerHeartbeat({
  status = "online",
  activeJobId = "",
  lastCompletedJobId = "",
  lastFailedJobId = "",
  lastError = "",
  jobsCompleted = 0,
  jobsFailed = 0,
  startedAt = "",
  metadata = {}
} = {}) {
  return {
    schemaVersion:
      1,

    workerName:
      WORKER_NAME,

    workerVersion:
      WORKER_VERSION,

    status:
      String(status),

    region:
      REGION,

    queueName:
      QUEUE_NAME,

    hostname:
      os.hostname(),

    processId:
      process.pid,

    nodeVersion:
      process.version,

    platform:
      process.platform,

    architecture:
      process.arch,

    activeJobId:
      String(activeJobId || ""),

    lastCompletedJobId:
      String(lastCompletedJobId || ""),

    lastFailedJobId:
      String(lastFailedJobId || ""),

    lastError:
      String(lastError || ""),

    jobsCompleted:
      Number(jobsCompleted || 0),

    jobsFailed:
      Number(jobsFailed || 0),

    memory: {
      rss:
        process.memoryUsage().rss,

      heapUsed:
        process.memoryUsage().heapUsed,

      heapTotal:
        process.memoryUsage().heapTotal,

      external:
        process.memoryUsage().external
    },

    uptimeSeconds:
      Math.round(
        process.uptime()
      ),

    startedAt:
      String(
        startedAt || ""
      ),

    heartbeatAt:
      new Date().toISOString(),

    metadata
  };
}

async function writeWorkerHeartbeat(
  heartbeat = {}
) {
  const record =
    buildWorkerHeartbeat(
      heartbeat
    );

  await s3.send(
    new PutObjectCommand({
      Bucket:
        BUCKET,

      Key:
        HEARTBEAT_KEY,

      Body:
        JSON.stringify(
          record,
          null,
          2
        ),

      ContentType:
        "application/json",

      CacheControl:
        "no-store"
    })
  );

  return record;
}

async function readWorkerHeartbeat() {
  try {
    const response =
      await s3.send(
        new GetObjectCommand({
          Bucket:
            BUCKET,

          Key:
            HEARTBEAT_KEY
        })
      );

    const body =
      await response.Body
        .transformToString();

    return JSON.parse(body);
  } catch (error) {
    if (
      error?.name === "NoSuchKey" ||
      error?.$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }

    throw error;
  }
}

function evaluateWorkerHeartbeat(
  heartbeat,
  staleAfterSeconds = 90
) {
  if (!heartbeat) {
    return {
      online: false,
      stale: true,
      ageSeconds: null,
      reason:
        "No worker heartbeat exists"
    };
  }

  const heartbeatTime =
    new Date(
      heartbeat.heartbeatAt
    ).getTime();

  const ageSeconds =
    Math.max(
      0,
      Math.round(
        (
          Date.now() -
          heartbeatTime
        ) / 1000
      )
    );

  const stale =
    !Number.isFinite(
      heartbeatTime
    ) ||
    ageSeconds >
      staleAfterSeconds;

  return {
    online:
      !stale &&
      heartbeat.status !==
        "offline",

    stale,

    ageSeconds,

    reason:
      stale
        ? "Worker heartbeat is stale"
        : "Worker heartbeat is current"
  };
}

module.exports = {
  WORKER_NAME,
  WORKER_VERSION,
  HEARTBEAT_KEY,
  buildWorkerHeartbeat,
  writeWorkerHeartbeat,
  readWorkerHeartbeat,
  evaluateWorkerHeartbeat
};
