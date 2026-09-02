const crypto = require("crypto");

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function sanitizeSegment(value = "") {
  const clean =
    String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180);

  return clean || "unknown";
}

function createActionId() {
  return `ixi-admin-${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}`;
}

function buildAuditKey({
  actionId,
  createdAt
} = {}) {
  const date =
    new Date(
      createdAt || Date.now()
    );

  const year =
    String(
      date.getUTCFullYear()
    );

  const month =
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getUTCDate()
    ).padStart(2, "0");

  return [
    "admin-audit",
    year,
    month,
    day,
    `${sanitizeSegment(actionId)}.json`
  ].join("/");
}

async function writeAdminAudit({
  adminId = "admin-daddy",
  actionType,
  targetType,
  targetId,
  machineKey = "",
  reason = "",
  requestContext = {},
  before = null,
  after = null,
  metadata = {}
} = {}) {
  if (!actionType) {
    throw new Error(
      "Admin audit requires actionType"
    );
  }

  if (!targetType) {
    throw new Error(
      "Admin audit requires targetType"
    );
  }

  if (!targetId) {
    throw new Error(
      "Admin audit requires targetId"
    );
  }

  const actionId =
    createActionId();

  const createdAt =
    new Date().toISOString();

  const record = {
    schemaVersion:
      1,

    actionId,

    adminId:
      String(
        adminId || "admin-daddy"
      ),

    actionType:
      String(actionType),

    targetType:
      String(targetType),

    targetId:
      String(targetId),

    machineKey:
      String(machineKey || ""),

    reason:
      String(reason || ""),

    requestContext: {
      ipAddress:
        String(
          requestContext.ipAddress || ""
        ),

      userAgent:
        String(
          requestContext.userAgent || ""
        ),

      requestId:
        String(
          requestContext.requestId || ""
        )
    },

    before,

    after,

    metadata,

    createdAt
  };

  const key =
    buildAuditKey({
      actionId,
      createdAt
    });

  record.auditKey =
    key;

  await s3.send(
    new PutObjectCommand({
      Bucket:
        BUCKET,

      Key:
        key,

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

async function getAdminAuditRecord(
  auditKey
) {
  if (!auditKey) {
    throw new Error(
      "Admin audit lookup requires auditKey"
    );
  }

  const response =
    await s3.send(
      new GetObjectCommand({
        Bucket:
          BUCKET,

        Key:
          String(auditKey)
      })
    );

  const body =
    await response.Body
      .transformToString();

  return JSON.parse(body);
}

async function listAdminAudit({
  machineKey = "",
  limit = 100
} = {}) {
  const listed =
    await s3.send(
      new ListObjectsV2Command({
        Bucket:
          BUCKET,

        Prefix:
          "admin-audit/"
      })
    );

  const objects =
    (listed.Contents || [])
      .sort(
        (a, b) =>
          new Date(b.LastModified) -
          new Date(a.LastModified)
      )
      .slice(
        0,
        Math.max(
          1,
          Math.min(
            Number(limit) || 100,
            500
          )
        )
      );

  const records = [];

  for (const object of objects) {
    const record =
      await getAdminAuditRecord(
        object.Key
      );

    if (
      machineKey &&
      record.machineKey !==
        machineKey
    ) {
      continue;
    }

    records.push(
      record
    );
  }

  return records;
}

module.exports = {
  sanitizeSegment,
  createActionId,
  buildAuditKey,
  writeAdminAudit,
  getAdminAuditRecord,
  listAdminAudit
};
