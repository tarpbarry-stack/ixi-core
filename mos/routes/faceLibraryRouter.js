const express =
  require("express");

const crypto =
  require("crypto");

const {
  sendMosError
} = require("./httpHelpers");

const {
  requireFaceRequestContext
} = require(
  "../faces/faceRequestContext"
);

const {
  listFaces,
  getFace,
  createFaceDraft,
  updateFaceDraft,
  publishFaceDraft,
  createNextFaceDraft,
  retireFace
} = require(
  "../faces/faceLibraryService"
);

const {
  createFaceAssignment,
  listFaceAssignments,
  removeFaceAssignment
} = require(
  "../faces/faceAssignmentService"
);

const {
  resolveAssignedFaces
} = require(
  "../faces/faceRuntimeService"
);

const {
  findActiveMembership
} = require(
  "../faces/facePermissionService"
);

const {
  getObject
} = require(
  "../objects/objectService"
);

const {
  getCommandRecord,
  beginCommand,
  completeCommand,
  failCommand
} = require(
  "../commands/idempotencyService"
);


const router =
  express.Router();


function parseRevision(req) {
  const raw =
    String(
      req.headers["if-match"] ||
      req.body?.expectedRevision ||
      ""
    )
      .replace(
        /^W\//,
        ""
      )
      .replace(
        /^"|"$/g,
        ""
      )
      .trim();

  const revision =
    Number(raw);

  return Number.isInteger(
    revision
  )
    ? revision
    : null;
}


function setRevisionEtag(
  res,
  revision
) {
  if (
    Number.isInteger(
      Number(revision)
    )
  ) {
    res.set(
      "ETag",
      `"${Number(revision)}"`
    );
  }
}


function payloadHash(
  payload
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        payload ?? null
      )
    )
    .digest("hex");
}


async function idempotentWrite({
  req,
  context,
  commandType,
  execute
}) {
  const commandId =
    String(
      req.headers[
        "idempotency-key"
      ] ||
      ""
    ).trim();

  if (!commandId) {
    const error =
      new Error(
        "Idempotency-Key header is required."
      );

    error.code =
      "IDEMPOTENCY_KEY_REQUIRED";

    error.statusCode = 428;

    throw error;
  }

  const hash =
    payloadHash({
      entityId:
        context.entityId,

      principalId:
        context.principalId,

      commandType,

      params:
        req.params,

      query:
        req.query,

      body:
        req.body
    });

  const existing =
    getCommandRecord(
      commandId
    );

  if (existing) {
    if (
      existing.payloadHash &&
      existing.payloadHash !==
        hash
    ) {
      const error =
        new Error(
          "Idempotency-Key was already used for a different request."
        );

      error.code =
        "IDEMPOTENCY_KEY_CONFLICT";

      error.statusCode = 409;

      throw error;
    }

    if (
      existing.status ===
        "completed"
    ) {
      return {
        replayed: true,
        result:
          existing.result
      };
    }

    if (
      existing.status ===
        "processing"
    ) {
      const error =
        new Error(
          "The idempotent command is already processing."
        );

      error.code =
        "IDEMPOTENCY_IN_PROGRESS";

      error.statusCode = 409;

      throw error;
    }
  }

  beginCommand({
    commandId,

    entityId:
      context.entityId,

    commandType,

    payloadHash:
      hash
  });

  try {
    const result =
      await execute();

    completeCommand({
      commandId,
      result
    });

    return {
      replayed: false,
      result
    };
  } catch (error) {
    failCommand({
      commandId,
      error
    });

    throw error;
  }
}


/* ---------- LIST ---------- */

router.get(
  "/faces",
  (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const faces =
        listFaces({
          entityId:
            context.entityId,

          principalId:
            context.principalId,

          status:
            req.query.status ||
            null
        });

      return res.json({
        ok: true,
        count:
          faces.length,
        faces
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- GET ---------- */

router.get(
  "/faces/:faceAppId",
  (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const result =
        getFace({
          entityId:
            context.entityId,

          principalId:
            context.principalId,

          faceAppId:
            req.params.faceAppId
        });

      const draft =
        result.versions.find(
          version =>
            version.lifecycle ===
              "draft"
        );

      if (draft) {
        setRevisionEtag(
          res,
          draft.revision
        );
      }

      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- CREATE ---------- */

router.post(
  "/drafts",
  async (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const command =
        await idempotentWrite({
          req,
          context,

          commandType:
            "face.draft.create",

          execute: () =>
            createFaceDraft({
              entityId:
                context.entityId,

              principalId:
                context.principalId,

              definition:
                req.body?.definition
            })
        });

      setRevisionEtag(
        res,
        command.result
          ?.version?.revision
      );

      return res
        .status(
          command.replayed
            ? 200
            : 201
        )
        .json({
          ok: true,
          replayed:
            command.replayed,
          ...command.result
        });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- NEXT VERSION DRAFT ---------- */

router.post(
  "/faces/:faceAppId/drafts",
  async (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const command =
        await idempotentWrite({
          req,
          context,

          commandType:
            "face.draft.next-version",

          execute: () =>
            createNextFaceDraft({
              entityId:
                context.entityId,

              principalId:
                context.principalId,

              faceAppId:
                req.params.faceAppId
            })
        });

      setRevisionEtag(
        res,
        command.result
          ?.version?.revision
      );

      return res
        .status(
          command.replayed
            ? 200
            : 201
        )
        .json({
          ok: true,
          replayed:
            command.replayed,
          ...command.result
        });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- UPDATE DRAFT ---------- */

router.patch(
  "/drafts/:faceAppId",
  (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const expectedRevision =
        parseRevision(req);

      const result =
        updateFaceDraft({
          entityId:
            context.entityId,

          principalId:
            context.principalId,

          faceAppId:
            req.params.faceAppId,

          definition:
            req.body?.definition,

          expectedRevision
        });

      setRevisionEtag(
        res,
        result.version.revision
      );

      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- PUBLISH ---------- */

router.post(
  "/drafts/:faceAppId/publish",
  async (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const expectedRevision =
        parseRevision(req);

      const command =
        await idempotentWrite({
          req,
          context,

          commandType:
            "face.publish",

          execute: () =>
            publishFaceDraft({
              entityId:
                context.entityId,

              principalId:
                context.principalId,

              faceAppId:
                req.params.faceAppId,

              expectedRevision
            })
        });

      return res.json({
        ok: true,
        replayed:
          command.replayed,
        ...command.result
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- RETIRE ---------- */

router.post(
  "/faces/:faceAppId/retire",
  async (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const command =
        await idempotentWrite({
          req,
          context,

          commandType:
            "face.retire",

          execute: () =>
            retireFace({
              entityId:
                context.entityId,

              principalId:
                context.principalId,

              faceAppId:
                req.params.faceAppId
            })
        });

      return res.json({
        ok: true,
        replayed:
          command.replayed,
        ...command.result
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- ASSIGNMENTS ---------- */

router.get(
  "/assignments",
  (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const assignments =
        listFaceAssignments({
          entityId:
            context.entityId,

          principalId:
            context.principalId,

          faceAppId:
            req.query.faceAppId ||
            null
        });

      return res.json({
        ok: true,
        count:
          assignments.length,
        assignments
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.post(
  "/assignments",
  async (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const command =
        await idempotentWrite({
          req,
          context,

          commandType:
            "face.assignment.create",

          execute: () =>
            createFaceAssignment({
              entityId:
                context.entityId,

              principalId:
                context.principalId,

              faceAppId:
                req.body?.faceAppId,

              target:
                req.body?.target,

              metadata:
                req.body?.metadata ||
                {}
            })
        });

      return res
        .status(
          command.replayed
            ? 200
            : 201
        )
        .json({
          ok: true,
          replayed:
            command.replayed,
          ...command.result
        });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.delete(
  "/assignments/:assignmentId",
  async (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const command =
        await idempotentWrite({
          req,
          context,

          commandType:
            "face.assignment.remove",

          execute: () =>
            removeFaceAssignment({
              entityId:
                context.entityId,

              principalId:
                context.principalId,

              assignmentId:
                req.params.assignmentId
            })
        });

      return res.json({
        ok: true,
        replayed:
          command.replayed,
        ...command.result
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- RUNTIME RESOLVE ---------- */

router.get(
  "/resolve/:objectId",
  (req, res) => {
    try {
      const context =
        requireFaceRequestContext(
          req
        );

      const object =
        getObject(
          req.params.objectId
        );

      if (
        object.entityId !==
          context.entityId
      ) {
        const error =
          new Error(
            "Object does not belong to the authenticated entity."
          );

        error.code =
          "FACE_OBJECT_ENTITY_MISMATCH";

        error.statusCode = 403;

        throw error;
      }

      const membership =
        findActiveMembership({
          entityId:
            context.entityId,

          principalId:
            context.principalId
        });

      const faces =
        resolveAssignedFaces({
          entityId:
            context.entityId,

          principalId:
            context.principalId,

          permissionScopes:
            Array.isArray(
              membership?.permissions
            )
              ? membership.permissions
              : [],

          object
        });

      return res.json({
        ok: true,

        objectId:
          object.objectId,

        count:
          faces.length,

        faces
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


module.exports = {
  faceLibraryRouter:
    router
};
