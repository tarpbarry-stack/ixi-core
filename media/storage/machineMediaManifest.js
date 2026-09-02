const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function sanitizeMachineKey(value = "") {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

  if (!clean) {
    throw new Error(
      "Machine Media Manifest requires machineId or passportId"
    );
  }

  return clean;
}

function getCanonicalMachineKey({
  machineId,
  passportId
} = {}) {
  return sanitizeMachineKey(
    passportId || machineId
  );
}

function buildManifestKey({
  machineId,
  passportId
} = {}) {
  const canonicalKey =
    getCanonicalMachineKey({
      machineId,
      passportId
    });

  return `machine-media/${canonicalKey}.json`;
}

function createMediaId(media = {}) {
  const hash =
    String(media.hash || "")
      .trim()
      .toLowerCase();

  if (!hash) {
    throw new Error(
      "Canonical media item requires hash"
    );
  }

  return `ixi-media-${hash}`;
}

function normalizeCanonicalMedia(
  media = []
) {
  const seenHashes =
    new Set();

  const normalized = [];

  [...media]
    .sort(
      (a, b) =>
        Number(a.position || 0) -
        Number(b.position || 0)
    )
    .forEach(
      (item, index) => {
        const hash =
          String(
            item?.hash || ""
          )
            .trim()
            .toLowerCase();

        if (
          !hash ||
          seenHashes.has(hash)
        ) {
          return;
        }

        seenHashes.add(hash);

        normalized.push({
          mediaId:
            createMediaId(item),

          position:
            normalized.length,

          hash,

          inputType:
            String(
              item.inputType || ""
            ),

          sourceReference:
            String(
              item.sourceReference || ""
            ),

          sourceUrl:
            String(
              item.sourceUrl || ""
            ),

          sourceBucket:
            String(
              item.sourceBucket || ""
            ),

          sourceKey:
            String(
              item.sourceKey || ""
            ),

          original: {
            key:
              String(
                item.original?.key || ""
              ),

            url:
              String(
                item.original?.url || ""
              ),

            bytes:
              Number(
                item.original?.bytes || 0
              ),

            width:
              Number(
                item.original?.width || 0
              ),

            height:
              Number(
                item.original?.height || 0
              ),

            format:
              String(
                item.original?.format || ""
              ),

            contentType:
              String(
                item.original?.contentType || ""
              )
          },

          hero: {
            key:
              String(
                item.hero?.key || ""
              ),

            url:
              String(
                item.hero?.url || ""
              ),

            bytes:
              Number(
                item.hero?.bytes || 0
              ),

            width:
              Number(
                item.hero?.width || 0
              ),

            height:
              Number(
                item.hero?.height || 0
              ),

            contentType:
              String(
                item.hero?.contentType || ""
              )
          },

          display: {
            key:
              String(
                item.display?.key || ""
              ),

            url:
              String(
                item.display?.url || ""
              ),

            bytes:
              Number(
                item.display?.bytes || 0
              ),

            width:
              Number(
                item.display?.width || 0
              ),

            height:
              Number(
                item.display?.height || 0
              ),

            contentType:
              String(
                item.display?.contentType || ""
              )
          },

          thumb: {
            key:
              String(
                item.thumb?.key || ""
              ),

            url:
              String(
                item.thumb?.url || ""
              ),

            bytes:
              Number(
                item.thumb?.bytes || 0
              ),

            width:
              Number(
                item.thumb?.width || 0
              ),

            height:
              Number(
                item.thumb?.height || 0
              ),

            contentType:
              String(
                item.thumb?.contentType || ""
              )
          },

          createdAt:
            item.createdAt ||
            new Date().toISOString()
        });
      }
    );

  return normalized;
}

async function getMachineMediaManifest({
  machineId,
  passportId
} = {}) {
  const key =
    buildManifestKey({
      machineId,
      passportId
    });

  try {
    const response =
      await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: key
        })
      );

    const body =
      await response.Body
        .transformToString();

    return JSON.parse(body);
  } catch (error) {
    if (
      error?.name ===
        "NoSuchKey" ||
      error?.$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }

    throw error;
  }
}

async function saveMachineMediaManifest(
  manifest = {}
) {
  if (!manifest.machineId) {
    throw new Error(
      "Manifest requires machineId"
    );
  }

  const key =
    buildManifestKey({
      machineId:
        manifest.machineId,

      passportId:
        manifest.passportId
    });

  const now =
    new Date().toISOString();

  const record = {
    ...manifest,

    schemaVersion:
      1,

    manifestKey:
      key,

    updatedAt:
      now
  };

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

async function replaceMachineMediaManifest({
  job,
  media = []
} = {}) {
  if (!job?.machineId) {
    throw new Error(
      "Manifest replacement requires job.machineId"
    );
  }

  const processedMedia =
    normalizeCanonicalMedia(
      media
    );

  if (
    processedMedia.length === 0
  ) {
    throw new Error(
      "Manifest update requires processed media"
    );
  }

  const existing =
    await getMachineMediaManifest({
      machineId:
        job.machineId,

      passportId:
        job.passportId
    });

  const manifestMode =
    String(
      job.manifestMode || ""
    )
      .trim()
      .toLowerCase() === "append"
        ? "append"
        : "replace";

  const existingMedia =
    Array.isArray(existing?.media)
      ? existing.media
      : [];

  const canonicalMedia =
    manifestMode === "append"
      ? normalizeCanonicalMedia([
          ...existingMedia,
          ...processedMedia
        ])
      : processedMedia;

  const orderedMediaIds =
    canonicalMedia.map(
      item => item.mediaId
    );

  const heroMediaId =
    orderedMediaIds[0] || "";

  const now =
    new Date().toISOString();

  return saveMachineMediaManifest({
    machineId:
      String(job.machineId),

    passportId:
      String(
        job.passportId || ""
      ),

    canonicalMachineKey:
      getCanonicalMachineKey({
        machineId:
          job.machineId,

        passportId:
          job.passportId
      }),

    mediaVersion:
      Number(
        existing?.mediaVersion || 0
      ) + 1,

    status:
      "active",

    heroMediaId,

    orderedMediaIds,

    media:
      canonicalMedia,

    mediaCount:
      canonicalMedia.length,

    sourceType:
      String(
        job.sourceType || ""
      ),

    sourceUrl:
      String(
        job.sourceUrl || ""
      ),

    sourcePhotoCount:
      Number(
        job.sourcePhotoCount ||
        canonicalMedia.length
      ),

    importedPhotoCount:
      Number(
        job.importedPhotoCount ||
        canonicalMedia.length
      ),

    selectionMode:
      String(
        job.selectionMode ||
        "all"
      ),

    manifestMode,

    latestJobId:
      String(
        job.jobId || ""
      ),

    createdAt:
      existing?.createdAt ||
      now
  });
}

module.exports = {
  sanitizeMachineKey,
  getCanonicalMachineKey,
  buildManifestKey,
  createMediaId,
  normalizeCanonicalMedia,
  getMachineMediaManifest,
  saveMachineMediaManifest,
  replaceMachineMediaManifest
};

async function setMachineMediaHero({
  machineId,
  passportId,
  mediaId
} = {}) {
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

  const exists =
    manifest.media?.some(
      item =>
        item.mediaId === mediaId
    );

  if (!exists) {
    throw new Error(
      `Media item not found: ${mediaId}`
    );
  }

  return saveMachineMediaManifest({
    ...manifest,

    mediaVersion:
      Number(
        manifest.mediaVersion || 0
      ) + 1,

    heroMediaId:
      mediaId
  });
}

async function reorderMachineMedia({
  machineId,
  passportId,
  orderedMediaIds = []
} = {}) {
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
    Array.isArray(manifest.media)
      ? manifest.media
      : [];

  if (
    !Array.isArray(orderedMediaIds) ||
    orderedMediaIds.length !==
      currentMedia.length
  ) {
    throw new Error(
      "orderedMediaIds must contain every media item exactly once"
    );
  }

  const currentIds =
    new Set(
      currentMedia.map(
        item => item.mediaId
      )
    );

  const submittedIds =
    new Set(
      orderedMediaIds
    );

  if (
    currentIds.size !==
      submittedIds.size ||
    [...currentIds].some(
      id =>
        !submittedIds.has(id)
    )
  ) {
    throw new Error(
      "orderedMediaIds does not match the current manifest"
    );
  }

  const byId =
    new Map(
      currentMedia.map(
        item => [
          item.mediaId,
          item
        ]
      )
    );

  const reordered =
    orderedMediaIds.map(
      (mediaId, index) => ({
        ...byId.get(mediaId),
        position:
          index
      })
    );

  return saveMachineMediaManifest({
    ...manifest,

    mediaVersion:
      Number(
        manifest.mediaVersion || 0
      ) + 1,

    orderedMediaIds:
      [...orderedMediaIds],

    media:
      reordered
  });
}

async function removeMachineMedia({
  machineId,
  passportId,
  mediaId
} = {}) {
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
    Array.isArray(manifest.media)
      ? manifest.media
      : [];

  const remaining =
    currentMedia
      .filter(
        item =>
          item.mediaId !== mediaId
      )
      .map(
        (item, index) => ({
          ...item,
          position:
            index
        })
      );

  if (
    remaining.length ===
      currentMedia.length
  ) {
    throw new Error(
      `Media item not found: ${mediaId}`
    );
  }

  const orderedMediaIds =
    remaining.map(
      item => item.mediaId
    );

  const nextHeroMediaId =
    manifest.heroMediaId ===
      mediaId
      ? orderedMediaIds[0] || ""
      : manifest.heroMediaId;

  return saveMachineMediaManifest({
    ...manifest,

    mediaVersion:
      Number(
        manifest.mediaVersion || 0
      ) + 1,

    heroMediaId:
      nextHeroMediaId,

    orderedMediaIds,

    media:
      remaining,

    mediaCount:
      remaining.length
  });
}

module.exports.setMachineMediaHero =
  setMachineMediaHero;

module.exports.reorderMachineMedia =
  reorderMachineMedia;

module.exports.removeMachineMedia =
  removeMachineMedia;
