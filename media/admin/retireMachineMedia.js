const {
  getMachineMediaManifest,
  removeMachineMedia
} = require(
  "../storage/machineMediaManifest"
);

const {
  saveRetiredMediaRecord
} = require(
  "../storage/retiredMediaStore"
);

const {
  writeAdminAudit
} = require("./adminAuditLog");

async function retireMachineMedia({
  machineId,
  passportId,
  mediaId,
  reason = "user-remove",
  removedBy = "system",
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
      "Retire media requires machineId or passportId"
    );
  }

  if (!mediaId) {
    throw new Error(
      "Retire media requires mediaId"
    );
  }

  const manifestBefore =
    await getMachineMediaManifest({
      machineId,
      passportId
    });

  if (!manifestBefore) {
    throw new Error(
      "Machine media manifest not found"
    );
  }

  const mediaItem =
    manifestBefore.media?.find(
      item =>
        item.mediaId === mediaId
    );

  if (!mediaItem) {
    throw new Error(
      `Media item not found: ${mediaId}`
    );
  }

  /*
   * Save the recovery record first.
   * Only after it is durable do we alter the active manifest.
   */
  const retired =
    await saveRetiredMediaRecord({
      machineKey,

      machineId:
        manifestBefore.machineId,

      passportId:
        manifestBefore.passportId,

      media:
        mediaItem,

      removedFromManifestVersion:
        manifestBefore.mediaVersion,

      reason,

      removedBy
    });

  const manifest =
    await removeMachineMedia({
      machineId,
      passportId,
      mediaId
    });

  const audit =
    await writeAdminAudit({
      adminId:
        removedBy,

      actionType:
        "media-retire",

      targetType:
        "machine-media",

      targetId:
        mediaId,

      machineKey,

      reason,

      requestContext,

      before: {
        manifestVersion:
          manifestBefore.mediaVersion,

        mediaCount:
          manifestBefore.mediaCount,

        heroMediaId:
          manifestBefore.heroMediaId,

        media:
          mediaItem
      },

      after: {
        manifestVersion:
          manifest.mediaVersion,

        mediaCount:
          manifest.mediaCount,

        heroMediaId:
          manifest.heroMediaId,

        retiredMediaKey:
          retired.retiredMediaKey,

        restoreStatus:
          retired.restoreStatus
      }
    });

  return {
    retired,
    manifest,
    audit
  };
}

module.exports = {
  retireMachineMedia
};
