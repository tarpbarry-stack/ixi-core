const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  createMosId
} = require("../objects/objectIdEngine");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const {
  validateFaceDefinition
} = require("./faceLibraryValidator");

const {
  FACE_PERMISSIONS,
  requireFacePermission
} = require("./facePermissionService");

const {
  validateFacePublication
} = require("./facePublicationValidationService");


function readLibrary() {
  return readJsonFile(
    MOS_PATHS.faceLibrary,
    {}
  );
}


function readVersions() {
  return readJsonFile(
    MOS_PATHS.faceVersions,
    {}
  );
}


function readAudit() {
  return readJsonFile(
    MOS_PATHS.faceAudit,
    {}
  );
}


function appendAudit({
  entityId,
  principalId,
  faceAppId,
  versionId = null,
  action,
  metadata = {}
}) {
  const audit =
    readAudit();

  const eventId =
    createMosId(
      "faceevent"
    );

  audit[eventId] = {
    eventId,

    entityId:
      cleanText(entityId),

    principalId:
      cleanText(principalId),

    faceAppId:
      cleanText(faceAppId),

    versionId:
      cleanText(versionId) ||
      null,

    action:
      cleanText(action),

    metadata:
      metadata &&
      typeof metadata ===
        "object" &&
      !Array.isArray(metadata)
        ? {
            ...metadata
          }
        : {},

    occurredAt:
      nowIso()
  };

  writeJsonFileAtomic(
    MOS_PATHS.faceAudit,
    audit
  );

  return audit[eventId];
}


function requireEntityId(
  entityId
) {
  const normalized =
    cleanText(entityId);

  if (!normalized) {
    throw new MosError(
      "FACE_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }

  return normalized;
}


function getFaceRecord({
  entityId,
  faceAppId
}) {
  const normalizedEntityId =
    requireEntityId(
      entityId
    );

  const normalizedFaceAppId =
    cleanText(faceAppId);

  const library =
    readLibrary();

  const record =
    library[
      normalizedFaceAppId
    ];

  if (
    !record ||
    record.entityId !==
      normalizedEntityId
  ) {
    throw new MosError(
      "FACE_NOT_FOUND",
      "Face App was not found.",
      {
        entityId:
          normalizedEntityId,

        faceAppId:
          normalizedFaceAppId
      },
      404
    );
  }

  return record;
}


function listFaces({
  entityId,
  principalId,
  status = null
}) {
  const normalizedEntityId =
    requireEntityId(
      entityId
    );

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS
        .LIBRARY_READ
  });

  const requestedStatus =
    cleanText(status)
      .toLowerCase();

  return Object.values(
    readLibrary()
  )
    .filter(
      record =>
        record.entityId ===
          normalizedEntityId
    )
    .filter(
      record =>
        !requestedStatus ||
        record.status ===
          requestedStatus
    )
    .sort(
      (a, b) =>
        String(
          b.updatedAt || ""
        ).localeCompare(
          String(
            a.updatedAt || ""
          )
        )
    );
}


function createFaceDraft({
  entityId,
  principalId,
  definition
}) {
  const normalizedEntityId =
    requireEntityId(
      entityId
    );

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS.CREATE
  });

  const validated =
    validateFaceDefinition(
      definition
    );

  const library =
    readLibrary();

  const duplicate =
    Object.values(
      library
    ).find(
      record =>
        record.entityId ===
          normalizedEntityId &&
        record.faceSlug ===
          validated.faceSlug &&
        record.status !==
          "retired"
    );

  if (duplicate) {
    throw new MosError(
      "FACE_SLUG_CONFLICT",
      "This entity already has an active Face App using that slug.",
      {
        entityId:
          normalizedEntityId,

        faceSlug:
          validated.faceSlug,

        faceAppId:
          duplicate.faceAppId
      },
      409
    );
  }

  const faceAppId =
    createMosId(
      "face"
    );

  const versionId =
    createMosId(
      "faceversion"
    );

  const timestamp =
    nowIso();

  const version = {
    versionId,
    faceAppId,

    entityId:
      normalizedEntityId,

    version: 1,

    lifecycle:
      "draft",

    revision: 1,

    definition:
      validated,

    createdBy:
      cleanText(
        principalId
      ),

    updatedBy:
      cleanText(
        principalId
      ),

    publishedBy:
      null,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    publishedAt:
      null,

    retiredAt:
      null
  };

  const record = {
    faceAppId,

    entityId:
      normalizedEntityId,

    ownerType:
      "customer",

    faceSlug:
      validated.faceSlug,

    label:
      validated.label,

    faceNumber:
      validated.faceNumber,

    status:
      "draft",

    activeVersionId:
      null,

    draftVersionId:
      versionId,

    latestVersion:
      1,

    createdBy:
      cleanText(
        principalId
      ),

    updatedBy:
      cleanText(
        principalId
      ),

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    retiredAt:
      null
  };

  const versions =
    readVersions();

  library[faceAppId] =
    record;

  versions[versionId] =
    version;

  /*
   * Write version first.
   * A library record must never point at
   * a version that does not exist.
   */
  writeJsonFileAtomic(
    MOS_PATHS.faceVersions,
    versions
  );

  writeJsonFileAtomic(
    MOS_PATHS.faceLibrary,
    library
  );

  appendAudit({
    entityId:
      normalizedEntityId,

    principalId,

    faceAppId,

    versionId,

    action:
      "face.draft.created",

    metadata: {
      version: 1
    }
  });

  return {
    record,
    version
  };
}


function getFace({
  entityId,
  principalId,
  faceAppId
}) {
  const normalizedEntityId =
    requireEntityId(
      entityId
    );

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS
        .LIBRARY_READ
  });

  const record =
    getFaceRecord({
      entityId:
        normalizedEntityId,

      faceAppId
    });

  const versions =
    readVersions();

  const allVersions =
    Object.values(
      versions
    )
      .filter(
        version =>
          version.faceAppId ===
            record.faceAppId &&
          version.entityId ===
            normalizedEntityId
      )
      .sort(
        (a, b) =>
          Number(
            b.version || 0
          ) -
          Number(
            a.version || 0
          )
      );

  return {
    record,
    versions:
      allVersions
  };
}


function updateFaceDraft({
  entityId,
  principalId,
  faceAppId,
  definition,
  expectedRevision
}) {
  const normalizedEntityId =
    requireEntityId(
      entityId
    );

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS.EDIT
  });

  const record =
    getFaceRecord({
      entityId:
        normalizedEntityId,

      faceAppId
    });

  if (!record.draftVersionId) {
    throw new MosError(
      "FACE_DRAFT_NOT_FOUND",
      "This Face App does not currently have an editable draft.",
      {
        faceAppId:
          record.faceAppId
      },
      409
    );
  }

  const versions =
    readVersions();

  const draft =
    versions[
      record.draftVersionId
    ];

  if (
    !draft ||
    draft.lifecycle !==
      "draft"
  ) {
    throw new MosError(
      "FACE_DRAFT_INVALID",
      "The current draft version is missing or immutable.",
      {
        faceAppId:
          record.faceAppId,

        draftVersionId:
          record.draftVersionId
      },
      409
    );
  }

  const requestedRevision =
    Number(
      expectedRevision
    );

  if (
    !Number.isInteger(
      requestedRevision
    )
  ) {
    throw new MosError(
      "FACE_REVISION_REQUIRED",
      "expectedRevision is required for draft updates.",
      null,
      428
    );
  }

  if (
    requestedRevision !==
    Number(
      draft.revision
    )
  ) {
    throw new MosError(
      "FACE_REVISION_CONFLICT",
      "The Face draft changed before this update was applied.",
      {
        expectedRevision:
          requestedRevision,

        currentRevision:
          draft.revision
      },
      409
    );
  }

  const validated =
    validateFaceDefinition(
      definition
    );

  /*
   * Identity slug is stable once the
   * Face App exists.
   */
  if (
    validated.faceSlug !==
    record.faceSlug
  ) {
    throw new MosError(
      "FACE_SLUG_IMMUTABLE",
      "faceSlug cannot be changed after Face App creation.",
      {
        faceSlug:
          record.faceSlug,

        requestedFaceSlug:
          validated.faceSlug
      },
      409
    );
  }

  const timestamp =
    nowIso();

  const nextDraft = {
    ...draft,

    definition:
      validated,

    revision:
      Number(
        draft.revision || 0
      ) + 1,

    updatedBy:
      cleanText(
        principalId
      ),

    updatedAt:
      timestamp
  };

  versions[
    draft.versionId
  ] = nextDraft;

  const library =
    readLibrary();

  /*
   * Draft edits must never mutate the
   * currently published Face identity.
   *
   * The draft definition owns its proposed
   * label/faceNumber until publication.
   */
  library[
    record.faceAppId
  ] = {
    ...record,

    updatedBy:
      cleanText(
        principalId
      ),

    updatedAt:
      timestamp
  };

  writeJsonFileAtomic(
    MOS_PATHS.faceVersions,
    versions
  );

  writeJsonFileAtomic(
    MOS_PATHS.faceLibrary,
    library
  );

  appendAudit({
    entityId:
      normalizedEntityId,

    principalId,

    faceAppId:
      record.faceAppId,

    versionId:
      draft.versionId,

    action:
      "face.draft.updated",

    metadata: {
      revision:
        nextDraft.revision
    }
  });

  return {
    record:
      library[
        record.faceAppId
      ],

    version:
      nextDraft
  };
}



function publishFaceDraft({
  entityId,
  principalId,
  faceAppId,
  expectedRevision
}) {
  const normalizedEntityId =
    requireEntityId(entityId);

  const membership =
    requireFacePermission({
      entityId:
        normalizedEntityId,

      principalId,

      permission:
        FACE_PERMISSIONS.PUBLISH
    });

  const record =
    getFaceRecord({
      entityId:
        normalizedEntityId,
      faceAppId
    });

  if (!record.draftVersionId) {
    throw new MosError(
      "FACE_DRAFT_NOT_FOUND",
      "This Face App has no draft to publish.",
      {
        faceAppId:
          record.faceAppId
      },
      409
    );
  }

  const versions =
    readVersions();

  const draft =
    versions[
      record.draftVersionId
    ];

  if (
    !draft ||
    draft.lifecycle !==
      "draft"
  ) {
    throw new MosError(
      "FACE_DRAFT_INVALID",
      "The current Face draft is missing or is not editable.",
      {
        faceAppId:
          record.faceAppId,
        draftVersionId:
          record.draftVersionId
      },
      409
    );
  }

  const requestedRevision =
    Number(expectedRevision);

  if (
    !Number.isInteger(
      requestedRevision
    )
  ) {
    throw new MosError(
      "FACE_REVISION_REQUIRED",
      "expectedRevision is required to publish a Face draft.",
      null,
      428
    );
  }

  if (
    requestedRevision !==
    Number(draft.revision)
  ) {
    throw new MosError(
      "FACE_REVISION_CONFLICT",
      "The Face draft changed before publish was applied.",
      {
        expectedRevision:
          requestedRevision,
        currentRevision:
          draft.revision
      },
      409
    );
  }

  /*
   * Revalidate at the publication boundary.
   * Publication never trusts an old draft validation.
   */
  const validated =
    validateFaceDefinition(
      draft.definition
    );

  /*
   * Revalidate this draft against every
   * currently active assignment BEFORE
   * it becomes the active published version.
   */
  const publicationValidation =
    validateFacePublication({
      entityId:
        normalizedEntityId,

      principalId,

      faceAppId:
        record.faceAppId,

      definition:
        validated,

      permissionScopes:
        Array.isArray(
          membership.permissions
        )
          ? membership.permissions
          : []
    });

  if (
    !publicationValidation.compatible
  ) {
    throw new MosError(
      "FACE_PUBLICATION_INCOMPATIBLE",
      "This Face version is incompatible with one or more active assignments.",
      {
        checkedAssignments:
          publicationValidation
            .checkedAssignments,

        checkedObjects:
          publicationValidation
            .checkedObjects,

        incompatible:
          publicationValidation
            .incompatible,

        warnings:
          publicationValidation
            .warnings
      },
      409
    );
  }

  const timestamp =
    nowIso();

  const published = {
    ...draft,

    lifecycle:
      "published",

    definition:
      validated,

    publishedBy:
      cleanText(principalId),

    publishedAt:
      timestamp,

    updatedBy:
      cleanText(principalId),

    updatedAt:
      timestamp
  };

  versions[
    draft.versionId
  ] = published;

  const library =
    readLibrary();

  const nextRecord = {
    ...record,

    label:
      validated.label,

    faceNumber:
      validated.faceNumber,

    status:
      "active",

    activeVersionId:
      published.versionId,

    draftVersionId:
      null,

    updatedBy:
      cleanText(principalId),

    updatedAt:
      timestamp,

    retiredAt:
      null
  };

  library[
    record.faceAppId
  ] = nextRecord;

  /*
   * Published version must be durable before
   * the library record points at it.
   */
  writeJsonFileAtomic(
    MOS_PATHS.faceVersions,
    versions
  );

  writeJsonFileAtomic(
    MOS_PATHS.faceLibrary,
    library
  );

  appendAudit({
    entityId:
      normalizedEntityId,

    principalId,

    faceAppId:
      record.faceAppId,

    versionId:
      published.versionId,

    action:
      "face.published",

    metadata: {
      version:
        published.version,
      revision:
        published.revision
    }
  });

  return {
    record:
      nextRecord,

    version:
      published,

    validation:
      publicationValidation
  };
}


function createNextFaceDraft({
  entityId,
  principalId,
  faceAppId
}) {
  const normalizedEntityId =
    requireEntityId(entityId);

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS.EDIT
  });

  const record =
    getFaceRecord({
      entityId:
        normalizedEntityId,
      faceAppId
    });

  if (
    record.status ===
      "retired"
  ) {
    throw new MosError(
      "FACE_RETIRED",
      "A retired Face App cannot create a new draft.",
      {
        faceAppId:
          record.faceAppId
      },
      409
    );
  }

  if (record.draftVersionId) {
    throw new MosError(
      "FACE_DRAFT_ALREADY_EXISTS",
      "This Face App already has an editable draft.",
      {
        faceAppId:
          record.faceAppId,
        draftVersionId:
          record.draftVersionId
      },
      409
    );
  }

  if (!record.activeVersionId) {
    throw new MosError(
      "FACE_ACTIVE_VERSION_REQUIRED",
      "A published Face version is required before creating the next draft.",
      {
        faceAppId:
          record.faceAppId
      },
      409
    );
  }

  const versions =
    readVersions();

  const activeVersion =
    versions[
      record.activeVersionId
    ];

  if (
    !activeVersion ||
    activeVersion.lifecycle !==
      "published"
  ) {
    throw new MosError(
      "FACE_ACTIVE_VERSION_INVALID",
      "The active Face version is missing or invalid.",
      {
        faceAppId:
          record.faceAppId,
        activeVersionId:
          record.activeVersionId
      },
      409
    );
  }

  const nextVersionNumber =
    Math.max(
      Number(
        record.latestVersion || 0
      ),
      Number(
        activeVersion.version || 0
      )
    ) + 1;

  const versionId =
    createMosId(
      "faceversion"
    );

  const timestamp =
    nowIso();

  const draft = {
    versionId,

    faceAppId:
      record.faceAppId,

    entityId:
      normalizedEntityId,

    version:
      nextVersionNumber,

    lifecycle:
      "draft",

    revision: 1,

    definition:
      JSON.parse(
        JSON.stringify(
          activeVersion.definition
        )
      ),

    createdBy:
      cleanText(principalId),

    updatedBy:
      cleanText(principalId),

    publishedBy:
      null,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    publishedAt:
      null,

    retiredAt:
      null,

    sourceVersionId:
      activeVersion.versionId
  };

  versions[
    versionId
  ] = draft;

  const library =
    readLibrary();

  const nextRecord = {
    ...record,

    draftVersionId:
      versionId,

    latestVersion:
      nextVersionNumber,

    updatedBy:
      cleanText(principalId),

    updatedAt:
      timestamp
  };

  library[
    record.faceAppId
  ] = nextRecord;

  writeJsonFileAtomic(
    MOS_PATHS.faceVersions,
    versions
  );

  writeJsonFileAtomic(
    MOS_PATHS.faceLibrary,
    library
  );

  appendAudit({
    entityId:
      normalizedEntityId,

    principalId,

    faceAppId:
      record.faceAppId,

    versionId,

    action:
      "face.draft.version.created",

    metadata: {
      version:
        nextVersionNumber,

      sourceVersionId:
        activeVersion.versionId
    }
  });

  return {
    record:
      nextRecord,
    version:
      draft
  };
}


function retireFace({
  entityId,
  principalId,
  faceAppId
}) {
  const normalizedEntityId =
    requireEntityId(entityId);

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS.RETIRE
  });

  const record =
    getFaceRecord({
      entityId:
        normalizedEntityId,
      faceAppId
    });

  if (
    record.status ===
      "retired"
  ) {
    return {
      record,
      alreadyRetired: true
    };
  }

  if (record.draftVersionId) {
    throw new MosError(
      "FACE_DRAFT_EXISTS",
      "Retire the Face only after its open draft is published or discarded.",
      {
        faceAppId:
          record.faceAppId,
        draftVersionId:
          record.draftVersionId
      },
      409
    );
  }

  const timestamp =
    nowIso();

  const library =
    readLibrary();

  const nextRecord = {
    ...record,

    status:
      "retired",

    updatedBy:
      cleanText(principalId),

    updatedAt:
      timestamp,

    retiredAt:
      timestamp
  };

  library[
    record.faceAppId
  ] = nextRecord;

  writeJsonFileAtomic(
    MOS_PATHS.faceLibrary,
    library
  );

  appendAudit({
    entityId:
      normalizedEntityId,

    principalId,

    faceAppId:
      record.faceAppId,

    versionId:
      record.activeVersionId,

    action:
      "face.retired"
  });

  return {
    record:
      nextRecord,
    alreadyRetired: false
  };
}


function getPublishedFaceVersion({
  entityId,
  faceAppId
}) {
  const record =
    getFaceRecord({
      entityId,
      faceAppId
    });

  if (
    record.status !== "active" ||
    !record.activeVersionId
  ) {
    throw new MosError(
      "FACE_NOT_ACTIVE",
      "The Face App does not have an active published version.",
      {
        faceAppId:
          record.faceAppId
      },
      409
    );
  }

  const versions =
    readVersions();

  const version =
    versions[
      record.activeVersionId
    ];

  if (
    !version ||
    version.lifecycle !==
      "published"
  ) {
    throw new MosError(
      "FACE_PUBLISHED_VERSION_INVALID",
      "The published Face version is missing or invalid.",
      {
        faceAppId:
          record.faceAppId,
        activeVersionId:
          record.activeVersionId
      },
      409
    );
  }

  return {
    record,
    version
  };
}

module.exports = {
  listFaces,
  getFace,
  getFaceRecord,
  getPublishedFaceVersion,
  createFaceDraft,
  updateFaceDraft,
  publishFaceDraft,
  createNextFaceDraft,
  retireFace
};
