const {
  S3Client,
  DeleteObjectsCommand,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require("../config/mediaConfig");

const {
  getRetiredMediaRecord
} = require("../storage/retiredMediaStore");

const {
  writeAdminAudit
} = require("./adminAuditLog");

const s3 = new S3Client({
  region: REGION
});

function collectMediaObjectKeys(media = {}) {
  return Array.from(
    new Set([
      media.original?.key,
      media.hero?.key,
      media.display?.key,
      media.thumb?.key
    ].filter(Boolean))
  );
}

async function updateRetiredRecord(
  retired,
  updates = {}
) {
  const record = {
    ...retired,
    ...updates
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: retired.retiredMediaKey,
      Body: JSON.stringify(
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

async function permanentlyDeleteRetiredMedia({
  machineKey,
  mediaId,
  confirmation,
  reason,
  deletedBy = "admin-daddy",
  requestContext = {}
} = {}) {
  if (!machineKey) {
    throw new Error(
      "Permanent deletion requires machineKey"
    );
  }

  if (!mediaId) {
    throw new Error(
      "Permanent deletion requires mediaId"
    );
  }

  if (!reason) {
    throw new Error(
      "Permanent deletion requires reason"
    );
  }

  const requiredConfirmation =
    `DELETE ${mediaId} PERMANENTLY`;

  if (
    confirmation !==
    requiredConfirmation
  ) {
    throw new Error(
      `Confirmation must exactly equal: ${requiredConfirmation}`
    );
  }

  const retired =
    await getRetiredMediaRecord({
      machineKey,
      mediaId
    });

  if (!retired) {
    throw new Error(
      `Retired media record not found: ${mediaId}`
    );
  }

  if (
    retired.restoreStatus ===
    "restored"
  ) {
    throw new Error(
      "Active or restored media cannot be permanently deleted. Retire it again first."
    );
  }

  if (
    retired.permanentlyDeletedAt
  ) {
    throw new Error(
      `Media was already permanently deleted at ${retired.permanentlyDeletedAt}`
    );
  }

  const objectKeys =
    collectMediaObjectKeys(
      retired.media
    );

  if (objectKeys.length > 0) {
    const deletion =
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,

          Delete: {
            Quiet: false,

            Objects:
              objectKeys.map(
                Key => ({ Key })
              )
          }
        })
      );

    if (
      Array.isArray(
        deletion.Errors
      ) &&
      deletion.Errors.length > 0
    ) {
      throw new Error(
        `S3 failed to delete ${deletion.Errors.length} media object(s)`
      );
    }
  }

  const permanentlyDeletedAt =
    new Date().toISOString();

  const updatedRetired =
    await updateRetiredRecord(
      retired,
      {
        status:
          "permanently-deleted",

        restoreStatus:
          "unavailable",

        permanentlyDeletedAt,

        permanentlyDeletedBy:
          String(
            deletedBy ||
            "admin-daddy"
          ),

        permanentDeleteReason:
          String(reason),

        deletedObjectKeys:
          objectKeys
      }
    );

  const audit =
    await writeAdminAudit({
      adminId:
        deletedBy,

      actionType:
        "media-permanent-delete",

      targetType:
        "machine-media",

      targetId:
        mediaId,

      machineKey,

      reason,

      requestContext,

      before: {
        status:
          retired.status,

        restoreStatus:
          retired.restoreStatus,

        media:
          retired.media
      },

      after: {
        status:
          updatedRetired.status,

        restoreStatus:
          updatedRetired.restoreStatus,

        permanentlyDeletedAt,

        deletedObjectKeys:
          objectKeys
      }
    });

  return {
    retired:
      updatedRetired,

    audit,

    deletedObjectKeys:
      objectKeys
  };
}

module.exports = {
  collectMediaObjectKeys,
  permanentlyDeleteRetiredMedia
};
