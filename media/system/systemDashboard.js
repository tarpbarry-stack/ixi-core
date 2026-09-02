const {
  S3Client,
  ListObjectsV2Command
} = require("@aws-sdk/client-s3");

const {
  SQSClient,
  GetQueueUrlCommand,
  GetQueueAttributesCommand
} = require("@aws-sdk/client-sqs");

const {
  REGION,
  BUCKET,
  QUEUE_NAME,
  DELIVERY_BASE_URL
} = require("../config/mediaConfig");

const {
  PLATFORM_MODE
} = require("../config/mediaPolicy");

const {
  readWorkerHeartbeat,
  evaluateWorkerHeartbeat
} = require("./workerHeartbeat");

const {
  listAdminAudit
} = require("../admin/adminAuditLog");

const s3 = new S3Client({
  region: REGION
});

const sqs = new SQSClient({
  region: REGION
});

const DLQ_NAME =
  "ixi-media-ingestion-dlq";

function toNumber(value) {
  const number =
    Number(value || 0);

  return Number.isFinite(number)
    ? number
    : 0;
}

async function getQueueSnapshot(
  queueName
) {
  const queue =
    await sqs.send(
      new GetQueueUrlCommand({
        QueueName:
          queueName
      })
    );

  const response =
    await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl:
          queue.QueueUrl,

        AttributeNames: [
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
          "ApproximateNumberOfMessagesDelayed",
          "CreatedTimestamp",
          "LastModifiedTimestamp",
          "VisibilityTimeout",
          "MessageRetentionPeriod",
          "ReceiveMessageWaitTimeSeconds"
        ]
      })
    );

  const attributes =
    response.Attributes || {};

  return {
    queueName,

    queueUrl:
      queue.QueueUrl,

    availableMessages:
      toNumber(
        attributes
          .ApproximateNumberOfMessages
      ),

    inFlightMessages:
      toNumber(
        attributes
          .ApproximateNumberOfMessagesNotVisible
      ),

    delayedMessages:
      toNumber(
        attributes
          .ApproximateNumberOfMessagesDelayed
      ),

    oldestMessageAgeSeconds:
      null,

    oldestMessageAgeSource:
      "cloudwatch-not-configured",

    visibilityTimeoutSeconds:
      toNumber(
        attributes.VisibilityTimeout
      ),

    retentionSeconds:
      toNumber(
        attributes.MessageRetentionPeriod
      ),

    longPollingSeconds:
      toNumber(
        attributes
          .ReceiveMessageWaitTimeSeconds
      ),

    createdTimestamp:
      attributes.CreatedTimestamp ||
      "",

    lastModifiedTimestamp:
      attributes
        .LastModifiedTimestamp ||
      ""
  };
}

async function scanPrefix(
  prefix
) {
  let continuationToken;
  let objectCount = 0;
  let totalBytes = 0;
  let latestModifiedAt = null;

  do {
    const response =
      await s3.send(
        new ListObjectsV2Command({
          Bucket:
            BUCKET,

          Prefix:
            prefix,

          ContinuationToken:
            continuationToken
        })
      );

    const objects =
      response.Contents || [];

    for (const object of objects) {
      objectCount += 1;

      totalBytes +=
        Number(
          object.Size || 0
        );

      const modified =
        object.LastModified
          ? new Date(
              object.LastModified
            )
          : null;

      if (
        modified &&
        (
          !latestModifiedAt ||
          modified >
            latestModifiedAt
        )
      ) {
        latestModifiedAt =
          modified;
      }
    }

    continuationToken =
      response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
  } while (continuationToken);

  return {
    prefix,
    objectCount,
    totalBytes,
    totalMegabytes:
      Number(
        (
          totalBytes /
          1024 /
          1024
        ).toFixed(2)
      ),

    totalGigabytes:
      Number(
        (
          totalBytes /
          1024 /
          1024 /
          1024
        ).toFixed(3)
      ),

    latestModifiedAt:
      latestModifiedAt
        ? latestModifiedAt
            .toISOString()
        : null
  };
}

async function checkCloudFront() {
  const base =
    String(
      DELIVERY_BASE_URL || ""
    ).replace(/\/+$/, "");

  const testUrl =
    `${base}/machines/IXIHTTP01/01-5979cb13f74f98c191a88cbc377ba61c0f2b666dccc9ea8199fdc3effa625d08-display.webp`;

  try {
    const response =
      await fetch(
        testUrl,
        {
          method: "HEAD",

          signal:
            AbortSignal.timeout(
              10000
            )
        }
      );

    return {
      healthy:
        response.ok,

      statusCode:
        response.status,

      url:
        testUrl,

      cacheStatus:
        response.headers.get(
          "x-cache"
        ) || "",

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

      checkedAt:
        new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy:
        false,

      statusCode:
        0,

      url:
        testUrl,

      cacheStatus:
        "",

      contentType:
        "",

      error:
        error?.message ||
        "CloudFront check failed",

      checkedAt:
        new Date().toISOString()
    };
  }
}

async function buildSystemDashboard() {
  const [
    heartbeat,
    mainQueue,
    deadLetterQueue,
    machines,
    manifests,
    mediaJobs,
    incoming,
    retired,
    audit,
    systemRecords,
    recentAudit,
    cloudFront
  ] = await Promise.all([
    readWorkerHeartbeat(),

    getQueueSnapshot(
      QUEUE_NAME
    ),

    getQueueSnapshot(
      DLQ_NAME
    ),

    scanPrefix(
      "machines/"
    ),

    scanPrefix(
      "machine-media/"
    ),

    scanPrefix(
      "media-jobs/"
    ),

    scanPrefix(
      "incoming/"
    ),

    scanPrefix(
      "retired-media/"
    ),

    scanPrefix(
      "admin-audit/"
    ),

    scanPrefix(
      "system/"
    ),

    listAdminAudit({
      limit:
        10
    }),

    checkCloudFront()
  ]);

  const workerHealth =
    evaluateWorkerHeartbeat(
      heartbeat
    );

  const totalStorageBytes =
    [
      machines,
      manifests,
      mediaJobs,
      incoming,
      retired,
      audit,
      systemRecords
    ].reduce(
      (
        total,
        area
      ) =>
        total +
        area.totalBytes,
      0
    );

  return {
    ok:
      true,

    generatedAt:
      new Date().toISOString(),

    platform: {
      service:
        "IXI Media Platform",

      platformMode:
        PLATFORM_MODE,

      region:
        REGION,

      bucket:
        BUCKET,

      deliveryBaseUrl:
        DELIVERY_BASE_URL
    },

    health: {
      overall:
        workerHealth.online &&
        cloudFront.healthy
          ? "healthy"
          : "attention",

      worker:
        workerHealth.online
          ? "healthy"
          : "offline-or-stale",

      mainQueue:
        mainQueue
          .availableMessages === 0
          ? "clear"
          : "backlog",

      deadLetterQueue:
        deadLetterQueue
          .availableMessages === 0
          ? "clear"
          : "attention",

      cloudFront:
        cloudFront.healthy
          ? "healthy"
          : "attention"
    },

    worker: {
      heartbeat,
      health:
        workerHealth
    },

    queues: {
      main:
        mainQueue,

      deadLetter:
        deadLetterQueue
    },

    storage: {
      totalBytes:
        totalStorageBytes,

      totalMegabytes:
        Number(
          (
            totalStorageBytes /
            1024 /
            1024
          ).toFixed(2)
        ),

      totalGigabytes:
        Number(
          (
            totalStorageBytes /
            1024 /
            1024 /
            1024
          ).toFixed(3)
        ),

      areas: {
        machines,
        manifests,
        mediaJobs,
        incoming,
        retired,
        audit,
        system:
          systemRecords
      }
    },

    counts: {
      canonicalManifests:
        manifests.objectCount,

      mediaJobRecords:
        mediaJobs.objectCount,

      incomingObjects:
        incoming.objectCount,

      retiredRecords:
        retired.objectCount,

      auditRecords:
        audit.objectCount,

      machineStorageObjects:
        machines.objectCount
    },

    cloudFront,

    recentAdminActions:
      recentAudit.map(
        record => ({
          actionId:
            record.actionId,

          actionType:
            record.actionType,

          adminId:
            record.adminId,

          targetType:
            record.targetType,

          targetId:
            record.targetId,

          machineKey:
            record.machineKey,

          reason:
            record.reason,

          createdAt:
            record.createdAt
        })
      )
  };
}

module.exports = {
  DLQ_NAME,
  toNumber,
  getQueueSnapshot,
  scanPrefix,
  checkCloudFront,
  buildSystemDashboard
};
