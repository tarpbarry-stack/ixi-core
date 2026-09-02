const {
  getMachineMediaManifest,
  saveMachineMediaManifest,
  normalizeCanonicalMedia
} = require(
  "../storage/machineMediaManifest"
);

const {
  getRetiredMediaRecord
} = require(
  "../storage/retiredMediaStore"
);

const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require(
  "../config/mediaConfig"
);

const {
  writeAdminAudit
} = require("./adminAuditLog");

const s3 = new S3Client({
  region: REGION
});

async function markRetiredMediaRestored(
  retired = {}
) {
  if (!retired.retiredMediaKey) {
    throw new Error(
      "Retired media record has no storage key"
    );
  }

  const updated = {
    ...retired,

    status:
      "restored",

    restoreStatus:
      "restored",

    restoredAt:
      new Date().toISOString()
  };

  await s3.send(
    new PutObjectCommand({
      Bucket:
        BUCKET,

      Key:
        retired.retiredMediaKey,

      Body:
        JSON.stringify(
          updated,
          null,
          2
        ),

      ContentType:
        "application/json",

      CacheControl:
        "no-store"
    })
  );

  return updated;
}

async function restoreMachineMedia({
  machineId,
  passportId,
  mediaId,
  position = null,
  setAsHero = false,
  restoredBy = "system",
  requestContext = {}
} = {}) {
  const machineKey =
    String(
      passportId ||
      machineId ||
      ""
    ).trim();

  if (!machineKey) {
    throw new Error(
      "Restore media requires machineId or passportId"
    );
  }

  if (!mediaId) {
    throw new Error(
      "Restore media requires mediaId"
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
      `Media item is already restored: ${mediaId}`
    );
  }

  const manifest =
    await getMachineMediaManifest({
      machineId,
      passportId
    });

  if (!manifest) {
    throw new Error(
      "Machine media manifest not found"
    );
  }

  const currentMedia =
    Array.isArray(
      manifest.media
    )
      ? manifest.media
      : [];

  const alreadyActive =
    currentMedia.some(
      item =>
        item.mediaId ===
        mediaId
    );

  if (alreadyActive) {
    throw new Error(
      `Media item is already active: ${mediaId}`
    );
  }

  const requestedPosition =
    Number(position);

  const insertAt =
    Number.isFinite(
      requestedPosition
    )
      ? Math.max(
          0,
          Math.min(
            requestedPosition,
            currentMedia.length
          )
        )
      : currentMedia.length;

  const nextMedia = [
    ...currentMedia
  ];

  nextMedia.splice(
    insertAt,
    0,
    retired.media
  );

  const normalized =
    normalizeCanonicalMedia(
      nextMedia
    );

  const orderedMediaIds =
    normalized.map(
      item => item.mediaId
    );

  const nextHeroMediaId =
    setAsHero
      ? mediaId
      : (
          manifest.heroMediaId ||
          orderedMediaIds[0] ||
          ""
        );

  const saved =
    await saveMachineMediaManifest({
      ...manifest,

      mediaVersion:
        Number(
          manifest.mediaVersion || 0
        ) + 1,

      heroMediaId:
        nextHeroMediaId,

      orderedMediaIds,

      media:
        normalized,

      mediaCount:
        normalized.length,

      lastRestore: {
        mediaId,
        restoredBy:
          String(
            restoredBy ||
            "system"
          ),

        restoredAt:
          new Date().toISOString()
      }
    });

  const updatedRetired =
    await markRetiredMediaRestored(
      retired
    );

  const audit =
    await writeAdminAudit({
      adminId:
        restoredBy,

      actionType:
        "media-restore",

      targetType:
        "machine-media",

      targetId:
        mediaId,

      machineKey,

      reason:
        "Restore retired machine media",

      requestContext,

      before: {
        manifestVersion:
          manifest.mediaVersion,

        mediaCount:
          manifest.mediaCount,

        heroMediaId:
          manifest.heroMediaId,

        retiredStatus:
          retired.status,

        restoreStatus:
          retired.restoreStatus
      },

      after: {
        manifestVersion:
          saved.mediaVersion,

        mediaCount:
          saved.mediaCount,

        heroMediaId:
          saved.heroMediaId,

        retiredStatus:
          updatedRetired.status,

        restoreStatus:
          updatedRetired.restoreStatus,

        restoredAt:
          updatedRetired.restoredAt
      },

      metadata: {
        position:
          insertAt,

        setAsHero:
          Boolean(setAsHero)
      }
    });

  return {
    manifest:
      saved,

    retired:
      updatedRetired,

    audit
  };
}

module.exports = {
  markRetiredMediaRestored,
  restoreMachineMedia
};
