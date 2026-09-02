const express = require("express");

const {
  createEntity,
  getEntity,
  listEntities
} = require("../entities/entityService");

const {
  createObject,
  getObject,
  listObjects,
  updateObject,
  softDeleteObject
} = require("../objects/objectService");

const {
  provisionAosObject
} = require(
  "../provisioning/aosObjectProvisioningService"
);

const {
  recoverAosObjectProvisioning
} = require(
  "../provisioning/aosObjectProvisioningRecoveryService"
);

const {
  createImportJob,
  listImportJobs,
  getImportJob,
  updateImportJobMapping,
  stageImportRows,
  cancelImportJob
} = require(
  "../imports/aosImportJobService"
);

const {
  executeImportRow,
  executeImportBatch
} = require(
  "../imports/aosImportExecutionService"
);

const {
  placeObjectInContainer,
  removeObjectFromContainer,
  resolveEffectivePath,
  listDirectContents,
  listAllDescendants
} = require("../containers/containerService");

const {
  executeImmediateMove,
  requestFreightMove,
  completeFreightMove,
  listMovements
} = require("../movements/movementService");

const {
  rebuildEntityProjections,
  getContainerProjection,
  getBranchSummary
} = require("../projections/projectionService");

const {
  listEvents
} = require("../events/eventService");

const {
  sendMosError
} = require("./httpHelpers");

const {
  faceLibraryRouter
} = require("./faceLibraryRouter");

const {
  loadAosEnvironment
} = require("../accounts/aosEnvironmentService");

const {
  listCardTemplates,
  getCardTemplate,
  createCustomerCardTemplate
} = require("../cards/cardTemplateService");

const {
  createCustomerObjectType,
  getCustomerObjectType,
  listCustomerObjectTypes,
  updateCustomerObjectType,
  archiveCustomerObjectType
} = require("../objects/customerObjectTypeService");

const {
  assertMosObjectAuthority,
  filterDiscoverableObjects
} = require(
  "../../authority/IXIAuthorityMosBridge"
);

const {
  resolveAosEntityId
} = require(
  "../../identity/IXIEntityBindingService"
);

const {
  assertTrustedMosEntity,
  filterDiscoverableMosRecords
} = require(
  "../../authority/IXIAuthorityMosScope"
);


const {
  createInternalAuthMiddleware
} = require(
  "../security/internalRequestAuthService"
);

const {
  createInternalTenantBoundaryMiddleware
} = require(
  "../security/internalTenantBoundaryService"
);

const {
  createCreationIntegrityRouter
} = require(
  "../../integrity/creationIntegrityRouter"
);

const {
  loadObjects:
    loadCreationIntegrityObjects,

  loadPassports:
    loadCreationIntegrityPassports,

  loadProvisioningRecords:
    loadCreationIntegrityProvisioningRecords
} = require(
  "../integrity/liveCreationIntegrityAdapter"
);


const router = express.Router();

/* ---------- HEALTH ---------- */

router.get("/health", (req, res) => {
  return res.json({
    ok: true,
    service: "ixi-mos",
    version: "v1"
  });
});

/*
 * Everything below public health enters
 * the IXI internal trust boundary.
 *
 * Enforcement remains OFF until the
 * coordinated Vercel + IX-Core rollout.
 */
router.use(
  createInternalAuthMiddleware()
);

router.use(
  createInternalTenantBoundaryMiddleware()
);


/*
 * AOS permanent-birth integrity control plane.
 *
 * Read-only.
 * Authenticated Entity comes exclusively from
 * req.ixiRequestContext after HMAC + tenant
 * boundary enforcement.
 */
router.use(
  "/aos/creation-integrity",

  createCreationIntegrityRouter({
    resolveActor:
      async req => ({
        entityId:
          req.ixiRequestContext
            ?.entityId,

        principalId:
          req.ixiRequestContext
            ?.principalId
      }),

    loadObjects:
      loadCreationIntegrityObjects,

    loadPassports:
      loadCreationIntegrityPassports,

    loadProvisioningRecords:
      loadCreationIntegrityProvisioningRecords
  })
);


/*
 * Face Library is a protected MOS resource.
 *
 * It MUST be mounted below both:
 *
 *   1. internal cryptographic authentication
 *   2. authenticated tenant boundary
 *
 * requireFaceRequestContext() can therefore
 * consume req.ixiRequestContext as its
 * canonical production identity.
 */
router.use(
  "/aos/face-library",
  faceLibraryRouter
);


/* ---------- AOS ENVIRONMENT ---------- */

router.post(
  "/aos/environment",
  async (req, res) => {
    try {
      const authenticatedAccess =
        req.ixiAuthenticatedAccess;

      let trustedEntity =
        null;

      if (authenticatedAccess) {
        const trustedEntityId =
          authenticatedAccess
            ?.membership
            ?.entityId ||
          authenticatedAccess
            ?.identity
            ?.entityId ||
          "";

        if (!trustedEntityId) {
          throw new MosError(
            "AOS_ENTITY_CONTEXT_REQUIRED",
            "Authenticated AOS access requires an Entity context.",
            null,
            400
          );
        }

        const resolvedAosEntityId =
          await resolveAosEntityId(
            trustedEntityId
          );

        if (!resolvedAosEntityId) {
          throw new MosError(
            "AOS_ENTITY_BINDING_REQUIRED",
            "Authenticated IXI Entity is not bound to an AOS Entity.",
            {
              identityEntityId:
                trustedEntityId
            },
            409
          );
        }

        trustedEntity =
          getEntity(
            resolvedAosEntityId
          );
      }

      const environment =
        await loadAosEnvironment({
          /*
           * Legacy compatibility only.
           *
           * Authenticated requests derive
           * identity and entity from IXI.
           */
          ownerUserId:
            authenticatedAccess
              ? (
                  authenticatedAccess
                    ?.authentication
                    ?.username ||
                  authenticatedAccess
                    ?.authentication
                    ?.cognitoSubject
                )
              : req.body?.ownerUserId,

          displayName:
            req.body?.displayName ||
            "IXI Entity",

          metadata:
            req.body?.metadata || {},

          trustedEntity,

          authorityPrincipal:
            req.ixiAuthorityPrincipal ||
            null
        });

      return res.json({
        ok: true,
        productName: "IXI AOS",
        environment
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

/* ---------- AOS IMPORT JOBS ---------- */

router.post(
  "/imports/jobs",
  (req, res) => {
    try {
      const result =
        createImportJob({
          ...(req.body || {})
        });

      return res.status(
        result.duplicate
          ? 200
          : 201
      ).json({
        ok: true,
        duplicate:
          result.duplicate === true,
        job:
          result.job
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.get(
  "/imports/jobs",
  (req, res) => {
    try {
      const jobs =
        listImportJobs({
          entityId:
            req.query?.entityId,

          status:
            req.query?.status ||
            null
        });

      return res.json({
        ok: true,
        count:
          jobs.length,
        jobs
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.get(
  "/imports/jobs/:jobId",
  (req, res) => {
    try {
      const job =
        getImportJob({
          jobId:
            req.params.jobId,

          entityId:
            req.query?.entityId
        });

      return res.json({
        ok: true,
        job
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.patch(
  "/imports/jobs/:jobId/mapping",
  (req, res) => {
    try {
      const job =
        updateImportJobMapping({
          jobId:
            req.params.jobId,

          entityId:
            req.body?.entityId,

          definitionId:
            req.body?.definitionId ||
            null,

          definitionKey:
            req.body?.definitionKey ||
            null,

          mapping:
            req.body?.mapping || {}
        });

      return res.json({
        ok: true,
        job
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
  "/imports/jobs/:jobId/rows",
  (req, res) => {
    try {
      const job =
        stageImportRows({
          jobId:
            req.params.jobId,

          entityId:
            req.body?.entityId,

          rows:
            req.body?.rows || []
        });

      return res.json({
        ok: true,
        job
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
  "/imports/jobs/:jobId/rows/:rowId/execute",
  (req, res) => {
    try {
      const result =
        executeImportRow({
          jobId:
            req.params.jobId,

          entityId:
            req.body?.entityId,

          rowId:
            req.params.rowId,

          actorId:
            req.body?.actorId ||
            null
        });

      return res.json(
        result
      );
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.post(
  "/imports/jobs/:jobId/execute",
  (req, res) => {
    try {
      const result =
        executeImportBatch({
          jobId:
            req.params.jobId,

          entityId:
            req.body?.entityId,

          actorId:
            req.body?.actorId ||
            null,

          limit:
            req.body?.limit ||
            25
        });

      return res.json(
        result
      );
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.post(
  "/imports/jobs/:jobId/cancel",
  (req, res) => {
    try {
      const job =
        cancelImportJob({
          jobId:
            req.params.jobId,

          entityId:
            req.body?.entityId
        });

      return res.json({
        ok: true,
        job
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- DURABLE OBJECT PROVISIONING ---------- */

router.post(
  "/objects/provision",
  (req, res) => {
    try {
      const commandId =
        String(
          req.headers[
            "idempotency-key"
          ] ||
          req.body?.commandId ||
          ""
        ).trim();

      const result =
        provisionAosObject({
          ...(req.body || {}),

          commandId
        });

      return res.status(
        result.replayed
          ? 200
          : 201
      ).json(
        result
      );
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.post(
  "/objects/provision/:commandId/recover",
  (req, res) => {
    try {
      const result =
        recoverAosObjectProvisioning({
          commandId:
            req.params.commandId,

          entityId:
            req.body?.entityId,

          actorId:
            req.body?.actorId ||
            null
        });

      return res.json(
        result
      );
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- ENTITIES ---------- */

router.post("/entities", (req, res) => {
  try {
    const entity = createEntity(
      req.body || {}
    );

    return res.status(201).json({
      ok: true,
      entity
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.get("/entities", (req, res) => {
  try {
    const entities = listEntities();

    return res.json({
      ok: true,
      count: entities.length,
      entities
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.get(
  "/entities/:entityId",
  (req, res) => {
    try {
      const entity = getEntity(
        req.params.entityId
      );

      return res.json({
        ok: true,
        entity
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

/* ---------- CARD TEMPLATES ---------- */

router.get(
  "/card-templates",
  (req, res) => {
    try {
      const templates =
        listCardTemplates({
          entityId:
            req.query.entityId ||
            null,

          librarySection:
            req.query.librarySection ||
            null,

          baseObjectType:
            req.query.baseObjectType ||
            null
        });

      return res.json({
        ok: true,
        count: templates.length,
        templates
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
  "/card-templates",
  (req, res) => {
    try {
      const template =
        createCustomerCardTemplate({
          entityId:
            req.body?.entityId,

          template:
            req.body?.template
        });

      return res.status(201).json({
        ok: true,
        template
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.get(
  "/card-templates/:templateSlug",
  (req, res) => {
    try {
      const template =
        getCardTemplate({
          templateSlug:
            req.params.templateSlug,

          version:
            req.query.version ||
            null,

          entityId:
            req.query.entityId ||
            null
        });

      return res.json({
        ok: true,
        template
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- CUSTOMER OBJECT DEFINITIONS ---------- */

router.get(
  "/entities/:entityId/object-definitions",
  (req, res) => {
    try {
      const definitions =
        listCustomerObjectTypes({
          entityId:
            req.params.entityId,

          status:
            req.query.status ||
            "active"
        });

      return res.json({
        ok: true,
        count:
          definitions.length,
        definitions
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
  "/entities/:entityId/object-definitions",
  (req, res) => {
    try {
      const definition =
        createCustomerObjectType({
          ...(req.body || {}),

          entityId:
            req.params.entityId
        });

      return res
        .status(201)
        .json({
          ok: true,
          definition
        });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.get(
  "/entities/:entityId/object-definitions/:definitionId",
  (req, res) => {
    try {
      const definition =
        getCustomerObjectType({
          entityId:
            req.params.entityId,

          definitionId:
            req.params.definitionId
        });

      return res.json({
        ok: true,
        definition
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


router.patch(
  "/entities/:entityId/object-definitions/:definitionId",
  (req, res) => {
    try {
      const definition =
        updateCustomerObjectType({
          ...(req.body || {}),

          entityId:
            req.params.entityId,

          definitionId:
            req.params.definitionId
        });

      return res.json({
        ok: true,
        definition
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
  "/entities/:entityId/object-definitions/:definitionId",
  (req, res) => {
    try {
      const definition =
        archiveCustomerObjectType({
          entityId:
            req.params.entityId,

          definitionId:
            req.params.definitionId,

          actorId:
            req.body?.actorId ||
            null
        });

      return res.json({
        ok: true,
        definition
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);


/* ---------- OBJECTS ---------- */

router.post("/objects", (req, res) => {
  try {
    const object = createObject(
      req.body || {}
    );

    rebuildEntityProjections(
      object.entityId
    );

    return res.status(201).json({
      ok: true,
      object,
      branch:
        getBranchSummary(
          object.objectId
        )
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.get(
  "/objects/:objectId",
  async (req, res) => {
    try {
      const object =
        getObject(
          req.params.objectId
        );

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object,

        capability:
          "aos.view"
      });

      return res.json({
        ok: true,
        object,
        effectivePath:
          resolveEffectivePath(
            object.objectId
          ),
        branch:
          getBranchSummary(
            object.objectId
          )
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

router.patch(
  "/objects/:objectId",
  async (req, res) => {
    try {
      const currentObject =
        getObject(
          req.params.objectId
        );

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object:
          currentObject,

        capability:
          "aos.edit"
      });

      const trustedActorId =
        req.ixiAuthorityPrincipal
          ?.principalId ||
        req.body?.actorId ||
        null;

      const object =
        updateObject({
          ...(req.body || {}),

          objectId:
            req.params.objectId,

          actorId:
            trustedActorId
        });

      rebuildEntityProjections(
        object.entityId
      );

      return res.json({
        ok: true,

        object,

        branch:
          getBranchSummary(
            object.objectId
          )
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
  "/objects/:objectId",
  async (req, res) => {
    try {
      const currentObject =
        getObject(
          req.params.objectId
        );

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object:
          currentObject,

        capability:
          "aos.delete"
      });

      const trustedActorId =
        req.ixiAuthorityPrincipal
          ?.principalId ||
        req.body?.actorId ||
        null;

      const object =
        softDeleteObject({
          objectId:
            req.params.objectId,

          actorId:
            trustedActorId
        });

      rebuildEntityProjections(
        object.entityId
      );

      return res.json({
        ok: true,
        object
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

router.get(
  "/entities/:entityId/objects",
  async (req, res) => {
    try {
      const objects =
        listObjects({
          entityId:
            req.params.entityId,

          objectType:
            req.query.objectType ||
            null,

          status:
            req.query.status ||
            "active"
        });

      const discoverableObjects =
        await filterDiscoverableObjects({
          principal:
            req.ixiAuthorityPrincipal,

          objects
        });

      return res.json({
        ok: true,
        count:
          discoverableObjects.length,
        objects:
          discoverableObjects
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

/* ---------- CONTAINERS ---------- */

router.get(
  "/containers/:containerId",
  async (req, res) => {
    try {
      const container =
        getObject(
          req.params.containerId
        );

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object:
          container,

        capability:
          "aos.view"
      });

      const view =
        String(
          req.query.view ||
          "direct"
        ).toLowerCase();

      const contents =
        view === "all"
          ? listAllDescendants(
              container.objectId
            )
          : listDirectContents(
              container.objectId
            );

      const discoverableContents =
        await filterDiscoverableObjects({
          principal:
            req.ixiAuthorityPrincipal,

          objects:
            contents
        });

      let projection =
        getContainerProjection(
          container.objectId
        );

      if (!projection) {
        rebuildEntityProjections(
          container.entityId
        );

        projection =
          getContainerProjection(
            container.objectId
          );
      }

      return res.json({
        ok: true,
        container,
        view,
        count:
          discoverableContents.length,
        contents:
          discoverableContents,
        projection,
        effectivePath:
          resolveEffectivePath(
            container.objectId
          )
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
  "/containers/:containerId/place",
  async (req, res) => {
    try {
      const sourceObject =
        getObject(
          req.body?.objectId
        );

      const destinationContainer =
        getObject(
          req.params.containerId
        );

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object:
          sourceObject,

        capability:
          "aos.move"
      });

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object:
          destinationContainer,

        capability:
          "aos.move"
      });

      const trustedActorId =
        req.ixiAuthorityPrincipal
          ?.principalId ||
        req.body?.actorId ||
        null;

      const result =
        placeObjectInContainer({
          objectId:
            sourceObject.objectId,

          destinationContainerId:
            destinationContainer.objectId,

          actorId:
            trustedActorId,

          commandId:
            req.body?.commandId ||
            null,

          metadata:
            req.body?.metadata || {}
        });

      const object =
        getObject(
          req.body?.objectId
        );

      rebuildEntityProjections(
        object.entityId
      );

      return res.json({
        ok: true,
        result,
        sourceProjection:
          result.previousContainerId
            ? getContainerProjection(
                result
                  .previousContainerId
              )
            : null,

        destinationProjection:
          getContainerProjection(
            req.params.containerId
          )
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/objects/:objectId/remove-from-container",
  async (req, res) => {
    try {
      const object =
        getObject(
          req.params.objectId
        );

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object,

        capability:
          "aos.move"
      });

      if (object.directContainerId) {
        const currentContainer =
          getObject(
            object.directContainerId
          );

        await assertMosObjectAuthority({
          principal:
            req.ixiAuthorityPrincipal,

          object:
            currentContainer,

          capability:
            "aos.move"
        });
      }

      const trustedActorId =
        req.ixiAuthorityPrincipal
          ?.principalId ||
        req.body?.actorId ||
        null;

      const result =
        removeObjectFromContainer({
          objectId:
            req.params.objectId,

          actorId:
            trustedActorId,

          commandId:
            req.body?.commandId ||
            null,

          metadata:
            req.body?.metadata || {}
        });

      rebuildEntityProjections(
        object.entityId
      );

      return res.json({
        ok: true,
        result
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

/* ---------- MOVEMENTS ---------- */

router.post(
  "/movements/immediate",
  (req, res) => {
    try {
      const result =
        executeImmediateMove(
          req.body || {}
        );

      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/movements/freight",
  (req, res) => {
    try {
      const result =
        requestFreightMove(
          req.body || {}
        );

      return res
        .status(201)
        .json({
          ok: true,
          ...result
        });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/movements/:movementId/complete",
  (req, res) => {
    try {
      const result =
        completeFreightMove({
          commandId:
            req.body?.commandId,

          movementId:
            req.params.movementId,

          actorId:
            req.body?.actorId ||
            null
        });

      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.get(
  "/movements",
  async (req, res) => {
    try {
      const entityId =
        await assertTrustedMosEntity({
          req,

          requestedEntityId:
            req.query.entityId ||
            ""
        });

      if (
        req.ixiAuthorityPrincipal &&
        req.query.objectId
      ) {
        const requestedObject =
          getObject(
            req.query.objectId
          );

        await assertMosObjectAuthority({
          principal:
            req.ixiAuthorityPrincipal,

          object:
            requestedObject,

          capability:
            "aos.discover"
        });
      }

      const movements =
        listMovements({
          entityId:
            entityId ||
            req.query.entityId ||
            null,

          objectId:
            req.query.objectId ||
            null,

          status:
            req.query.status ||
            null
        });

      const discoverableMovements =
        await filterDiscoverableMosRecords({
          principal:
            req.ixiAuthorityPrincipal,

          records:
            movements
        });

      return res.json({
        ok: true,
        count:
          discoverableMovements.length,

        movements:
          discoverableMovements
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

/* ---------- PROJECTIONS ---------- */

router.post(
  "/entities/:entityId/projections/rebuild",
  async (req, res) => {
    try {
      const entityId =
        await assertTrustedMosEntity({
          req,

          requestedEntityId:
            req.params.entityId
        });

      const projections =
        rebuildEntityProjections(
          entityId ||
          req.params.entityId
        );

      const discoverableProjections =
        await filterDiscoverableMosRecords({
          principal:
            req.ixiAuthorityPrincipal,

          records:
            projections
        });

      return res.json({
        ok: true,
        count:
          discoverableProjections.length,

        projections:
          discoverableProjections
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

router.get(
  "/containers/:containerId/projection",
  async (req, res) => {
    try {
      const container =
        getObject(
          req.params.containerId
        );

      await assertTrustedMosEntity({
        req,

        requestedEntityId:
          container.entityId
      });

      await assertMosObjectAuthority({
        principal:
          req.ixiAuthorityPrincipal,

        object:
          container,

        capability:
          "aos.discover"
      });

      let projection =
        getContainerProjection(
          container.objectId
        );

      if (!projection) {
        rebuildEntityProjections(
          container.entityId
        );

        projection =
          getContainerProjection(
            container.objectId
          );
      }

      return res.json({
        ok: true,
        projection
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

/* ---------- EVENTS ---------- */

router.get(
  "/events",
  async (req, res) => {
    try {
      const entityId =
        await assertTrustedMosEntity({
          req,

          requestedEntityId:
            req.query.entityId ||
            ""
        });

      if (
        req.ixiAuthorityPrincipal &&
        req.query.objectId
      ) {
        const requestedObject =
          getObject(
            req.query.objectId
          );

        await assertMosObjectAuthority({
          principal:
            req.ixiAuthorityPrincipal,

          object:
            requestedObject,

          capability:
            "aos.discover"
        });
      }

      const events =
        listEvents({
          entityId:
            entityId ||
            req.query.entityId ||
            null,

          objectId:
            req.query.objectId ||
            null,

          eventType:
            req.query.eventType ||
            null
        });

      const discoverableEvents =
        await filterDiscoverableMosRecords({
          principal:
            req.ixiAuthorityPrincipal,

          records:
            events
        });

      return res.json({
        ok: true,
        count:
          discoverableEvents.length,

        events:
          discoverableEvents
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
  mosRouter: router
};
