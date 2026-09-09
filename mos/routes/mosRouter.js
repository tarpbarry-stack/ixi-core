const express = require("express");
const crypto = require("crypto");

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
  createObjectRelationship,
  endObjectRelationship,
  updateObjectRelationshipOrder,
  getRelationship,
  listRelatedObjects,
  traverseRelationships
} = require(
  "../relationships/relationshipService"
);

const {
  buildRelationshipIdentityEvidence,
  decorateRelationshipWithIdentityEvidence
} = require("../relationships/relationshipIdentityEvidenceService");

const {
  sendMosError
} = require("./httpHelpers");

const {
  describeMosStorage
} = require("../storage/jsonStore");

const {
  MosError
} = require("../errors/MosError");

const {
  beginCommand,
  completeCommand,
  failCommand
} = require("../commands/idempotencyService");

const {
  faceLibraryRouter
} = require("./faceLibraryRouter");

const {
  loadAosEnvironment
} = require("../accounts/aosEnvironmentService");

const {
  findAccountByOwnerUserId
} = require("../accounts/aosAccountService");

const {
  ensureCommercialOnboarding
} = require("../onboarding/aosCommercialOnboardingService");

const {
  provisionSharetribeMachine
} = require("../onboarding/sharetribeMachineProvisioningService");

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
  filterDiscoverableObjects,
  buildMosObjectActorAuthority
} = require(
  "../../authority/IXIAuthorityMosBridge"
);

const {
  resolveAosEntityId
} = require(
  "../../identity/IXIEntityBindingService"
);

const {
  resolveCanonicalObjectIdentity
} = require(
  "../identity/canonicalObjectAdmissionService"
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
  createMosMembershipAuthorityMiddleware,
  assertPrincipalCapability
} = require("../security/mosMembershipAuthorityService");

const {
  openWorkspaceSession,
  getWorkspaceSession,
  applyWorkspaceSessionCommand,
  endWorkspaceSession
} = require("../workspaces/sessionPlacementService");

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

function assertLegacyContainmentWriteEnabled() {
  if (
    String(process.env.IXI_MOS_LEGACY_CONTAINMENT_WRITES || "")
      .trim()
      .toLowerCase() !== "true"
  ) {
    throw new MosError(
      "LEGACY_CONTAINMENT_WRITE_DISABLED",
      "Exclusive legacy containment writes are disabled; use a governed technical edge.",
      null,
      410
    );
  }
}

function beginHttpCommand({
  req,
  entityId,
  commandType,
  payload
}) {
  const bodyCommandId = String(
    req.body?.commandId || ""
  ).trim();
  const idempotencyKey = String(
    req.headers["idempotency-key"] || ""
  ).trim();

  if (
    !bodyCommandId ||
    !idempotencyKey ||
    bodyCommandId !== idempotencyKey
  ) {
    throw new MosError(
      "GOVERNED_COMMAND_ID_REQUIRED",
      "A matching commandId and Idempotency-Key are required.",
      null,
      428
    );
  }

  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}))
    .digest("hex");

  const command = beginCommand({
    commandId: bodyCommandId,
    entityId,
    commandType,
    payloadHash
  });

  if (command.duplicate) {
    const record = command.record;
    if (
      record.entityId !== entityId ||
      record.commandType !== commandType ||
      record.payloadHash !== payloadHash
    ) {
      throw new MosError(
        "GOVERNED_COMMAND_REUSE_CONFLICT",
        "commandId was already used for a different governed mutation.",
        { commandId: bodyCommandId },
        409
      );
    }

    if (record.status === "completed" && record.result) {
      return {
        commandId: bodyCommandId,
        duplicate: true,
        result: record.result
      };
    }

    throw new MosError(
      "GOVERNED_COMMAND_NOT_REPLAYABLE",
      "The prior governed command did not complete and cannot be replayed.",
      { commandId: bodyCommandId, status: record.status },
      409
    );
  }

  return {
    commandId: bodyCommandId,
    duplicate: false,
    result: null
  };
}

function requireGovernedCommandId(req, code = "GOVERNED_COMMAND_ID_REQUIRED") {
  const bodyCommandId = String(req.body?.commandId || "").trim();
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (!bodyCommandId || !idempotencyKey || bodyCommandId !== idempotencyKey) {
    throw new MosError(
      code,
      "A matching commandId and Idempotency-Key are required for this governed operation.",
      null,
      428
    );
  }
  return bodyCommandId;
}

function requireGovernedIdempotencyKey(req, code = "GOVERNED_IDEMPOTENCY_KEY_REQUIRED") {
  const bodyCommandId = String(req.body?.commandId || "").trim();
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (!idempotencyKey || (bodyCommandId && bodyCommandId !== idempotencyKey)) {
    throw new MosError(
      code,
      "A stable Idempotency-Key is required and must match commandId when both are supplied.",
      null,
      428
    );
  }
  return idempotencyKey;
}

function governedPrincipal(req, capabilities = []) {
  const principal = req.ixiAuthorityPrincipal;
  for (const capability of capabilities) {
    assertPrincipalCapability(principal, capability);
  }
  return principal;
}

/* ---------- HEALTH ---------- */

router.get("/health", (req, res) => {
  try {
    const storage = describeMosStorage();
    return res.status(storage.ok ? 200 : 503).json({
      ok: storage.ok,
      service: "ixi-mos",
      version: "v1",
      storage
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      service: "ixi-mos",
      version: "v1",
      storage: {
        ok: false,
        code: error?.code || "MOS_STORAGE_UNAVAILABLE",
        error: error?.message || String(error)
      }
    });
  }
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

router.use(
  createMosMembershipAuthorityMiddleware()
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
  "/aos/onboarding/bootstrap",
  async (req, res) => {
    try {
      if (!req.ixiRequestContext?.authenticated) {
        throw new MosError(
          "AOS_ONBOARDING_AUTHENTICATION_REQUIRED",
          "Governed onboarding requires an authenticated signed principal.",
          null,
          401
        );
      }
      const principalId = req.ixiRequestContext.principalId;
      const suppliedCommandId = String(req.body?.commandId || "").trim();
      const commandId = suppliedCommandId || `governed-onboarding:${principalId}:v1`;
      const existingAccount = findAccountByOwnerUserId(principalId);
      const signedEntityId = String(req.ixiRequestContext.entityId || "").trim();
      if (signedEntityId && (!existingAccount || existingAccount.primaryEntityId !== signedEntityId)) {
        throw new MosError(
          "AOS_ONBOARDING_ENTITY_MISMATCH",
          "Signed Entity does not match the principal's existing governed account.",
          { signedEntityId },
          403
        );
      }

      const onboarding = ensureCommercialOnboarding({
        ownerUserId: principalId,
        entityDisplayName: req.body?.entityDisplayName,
        person: req.body?.person || {},
        metadata: {
          ...(req.body?.metadata || {}),
          creationBoundary: "governed-onboarding",
          commandId
        }
      });

      const environment = await loadAosEnvironment({
        ownerUserId: principalId,
        displayName: onboarding.entity.displayName,
        metadata: {
          source: "commercial-onboarding-bootstrap"
        }
      });

      environment.entity = {
        ...environment.entity,
        passportId: onboarding.passports.entityPassportId,
        entityPassportId: onboarding.passports.entityPassportId
      };

      environment.onboarding = onboarding;

      return res.status(200).json({
        ok: true,
        productName: "IXI AOS",
        onboarding,
        environment
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

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
            null,

          strictAuthorization:
            req.ixiRequestContext?.authenticated === true,

          allowProvisioning:
            false
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

function workspaceSessionContext(req, { shared = false } = {}) {
  const principal = req.ixiAuthorityPrincipal;
  assertPrincipalCapability(principal, "aos.workspace.placement.write");
  if (shared) assertPrincipalCapability(principal, "aos.workspace.shared");
  return {
    principalId: principal.principalId,
    entityId: principal.entityId,
    tenantId: principal.tenantId,
    sharedAuthorized: shared
  };
}

function requireMatchingRevision(req) {
  const expectedRevision = Number(req.body?.expectedRevision);
  const header = String(req.headers["if-match"] || "")
    .replace(/^W\//i, "")
    .replace(/^\"|\"$/g, "")
    .trim();
  if (!Number.isInteger(expectedRevision) || !header || Number(header) !== expectedRevision) {
    throw new MosError(
      "WORKSPACE_SESSION_REVISION_REQUIRED",
      "Matching expectedRevision and If-Match values are required.",
      { expectedRevision: req.body?.expectedRevision, ifMatch: req.headers["if-match"] || null },
      428
    );
  }
  return expectedRevision;
}

router.post("/aos/workspace-sessions", (req, res) => {
  let commandId = "";
  let started = false;
  try {
    const shared = String(req.body?.placementScope || "personal").toLowerCase() === "shared";
    const context = workspaceSessionContext(req, { shared });
    assertPrincipalCapability(req.ixiAuthorityPrincipal, "aos.workspace.session.open");
    const command = beginHttpCommand({
      req,
      entityId: context.entityId,
      commandType: "workspace.session.open",
      payload: {
        workspaceId: req.body?.workspaceId,
        placementScope: req.body?.placementScope || "personal",
        sharedScopeId: req.body?.sharedScopeId || null
      }
    });
    commandId = command.commandId;
    started = !command.duplicate;
    if (command.duplicate) return res.json({ ...command.result, replayed: true });
    const result = openWorkspaceSession({
      context,
      workspaceId: req.body?.workspaceId,
      placementScope: req.body?.placementScope,
      sharedScopeId: req.body?.sharedScopeId,
      ttlMs: req.body?.ttlMs,
      commandId
    });
    const response = { ok: true, result };
    completeCommand({ commandId, result: response });
    return res.status(result.created ? 201 : 200).json({ ...response, replayed: false });
  } catch (error) {
    if (commandId && started) failCommand({ commandId, error });
    return sendMosError(res, error);
  }
});

router.get("/aos/workspace-sessions/:sessionId", (req, res) => {
  try {
    const shared = String(req.query?.placementScope || "personal").toLowerCase() === "shared";
    const context = workspaceSessionContext(req, { shared });
    const session = getWorkspaceSession({ sessionId: req.params.sessionId, context });
    return res.json({ ok: true, session });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.post("/aos/workspace-sessions/:sessionId/commands", (req, res) => {
  let commandId = "";
  let started = false;
  try {
    const shared = String(req.body?.placementScope || "personal").toLowerCase() === "shared";
    const context = workspaceSessionContext(req, { shared });
    const expectedRevision = requireMatchingRevision(req);
    const command = beginHttpCommand({
      req,
      entityId: context.entityId,
      commandType: "workspace.session.command",
      payload: {
        sessionId: req.params.sessionId,
        expectedRevision,
        commandType: req.body?.commandType,
        payload: req.body?.payload || {}
      }
    });
    commandId = command.commandId;
    started = !command.duplicate;
    if (command.duplicate) return res.json({ ...command.result, replayed: true });
    const result = applyWorkspaceSessionCommand({
      context,
      sessionId: req.params.sessionId,
      expectedRevision,
      commandId,
      commandType: req.body?.commandType,
      payload: req.body?.payload || {}
    });
    const response = { ok: true, result };
    completeCommand({ commandId, result: response });
    return res.json({ ...response, replayed: false });
  } catch (error) {
    if (commandId && started) failCommand({ commandId, error });
    return sendMosError(res, error);
  }
});

router.post("/aos/workspace-sessions/:sessionId/end", (req, res) => {
  let commandId = "";
  let started = false;
  try {
    const shared = String(req.body?.placementScope || "personal").toLowerCase() === "shared";
    const context = workspaceSessionContext(req, { shared });
    const expectedRevision = requireMatchingRevision(req);
    const command = beginHttpCommand({
      req,
      entityId: context.entityId,
      commandType: "workspace.session.end",
      payload: { sessionId: req.params.sessionId, expectedRevision }
    });
    commandId = command.commandId;
    started = !command.duplicate;
    if (command.duplicate) return res.json({ ...command.result, replayed: true });
    const result = endWorkspaceSession({
      context,
      sessionId: req.params.sessionId,
      expectedRevision,
      commandId
    });
    const response = { ok: true, result };
    completeCommand({ commandId, result: response });
    return res.json({ ...response, replayed: false });
  } catch (error) {
    if (commandId && started) failCommand({ commandId, error });
    return sendMosError(res, error);
  }
});

/* ---------- AOS IMPORT JOBS ---------- */

router.post(
  "/imports/jobs",
  (req, res) => {
    let activeCommandId = "";
    let commandStarted = false;
    try {
      const principal = governedPrincipal(req, ["aos.import"]);
      const command = beginHttpCommand({
        req,
        entityId: principal.entityId,
        commandType: "import.job.create",
        payload: {
          sourceFile: req.body?.sourceFile || {},
          definitionId: req.body?.definitionId || null,
          definitionKey: req.body?.definitionKey || null,
          mapping: req.body?.mapping || {},
          rows: req.body?.rows || [],
          metadata: req.body?.metadata || {}
        }
      });
      activeCommandId = command.commandId;
      commandStarted = !command.duplicate;
      if (command.duplicate) return res.json({ ...command.result, replayed: true });
      const result =
        createImportJob({
          ...(req.body || {}),
          entityId: principal.entityId,
          actorId: principal.principalId,
          metadata: {
            ...(req.body?.metadata || {}),
            creationBoundary: "bulk-import",
            commandId: activeCommandId
          }
        });
      const response = {
        ok: true,
        duplicate: result.duplicate === true,
        job: result.job
      };
      completeCommand({ commandId: activeCommandId, result: response });
      return res.status(
        result.duplicate
          ? 200
          : 201
      ).json({ ...response, replayed: false });
    } catch (error) {
      if (activeCommandId && commandStarted) failCommand({ commandId: activeCommandId, error });
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
      const principal = governedPrincipal(req, ["aos.import"]);
      const job =
        updateImportJobMapping({
          jobId:
            req.params.jobId,

          entityId: principal.entityId,

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
      const principal = governedPrincipal(req, ["aos.import"]);
      const job =
        stageImportRows({
          jobId:
            req.params.jobId,

          entityId: principal.entityId,

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
    let activeCommandId = "";
    let commandStarted = false;
    try {
      const principal = governedPrincipal(req, ["aos.import", "aos.create"]);
      const command = beginHttpCommand({
        req,
        entityId: principal.entityId,
        commandType: "import.row.execute",
        payload: { jobId: req.params.jobId, rowId: req.params.rowId }
      });
      activeCommandId = command.commandId;
      commandStarted = !command.duplicate;
      if (command.duplicate) return res.json({ ...command.result, replayed: true });
      const result =
        executeImportRow({
          jobId:
            req.params.jobId,

          entityId: principal.entityId,

          rowId:
            req.params.rowId,

          actorId: principal.principalId
        });
      completeCommand({ commandId: activeCommandId, result });
      return res.json({ ...result, replayed: false });
    } catch (error) {
      if (activeCommandId && commandStarted) failCommand({ commandId: activeCommandId, error });
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
    let activeCommandId = "";
    let commandStarted = false;
    try {
      const principal = governedPrincipal(req, ["aos.import", "aos.create"]);
      const command = beginHttpCommand({
        req,
        entityId: principal.entityId,
        commandType: "import.batch.execute",
        payload: { jobId: req.params.jobId, limit: req.body?.limit || 25 }
      });
      activeCommandId = command.commandId;
      commandStarted = !command.duplicate;
      if (command.duplicate) return res.json({ ...command.result, replayed: true });
      const result =
        executeImportBatch({
          jobId:
            req.params.jobId,

          entityId: principal.entityId,

          actorId: principal.principalId,

          limit:
            req.body?.limit ||
            25
        });

      completeCommand({ commandId: activeCommandId, result });
      return res.json({ ...result, replayed: false });
    } catch (error) {
      if (activeCommandId && commandStarted) failCommand({ commandId: activeCommandId, error });
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
  async (req, res) => {
    try {
      const principal = governedPrincipal(req, ["aos.create"]);
      const commandId = requireGovernedCommandId(req, "AOS_PROVISION_COMMAND_ID_REQUIRED");

      const input = {
        ...(req.body || {})
      };

      /* Internal Passport adoption is never accepted from this route. */
      delete input.trustedPassportId;

      const result =
        provisionAosObject({
          ...input,

          commandId,

          entityId: principal.entityId,
          actorId: principal.principalId
        });

      const response = {
        ...result,
        object: await objectWithEffectiveAuthority(req, result.object)
      };

      return res.status(
        result.replayed
          ? 200
          : 201
      ).json(response);
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

router.post(
  "/aos/machines/sharetribe-listing",
  async (req, res) => {
    try {
      const principal = governedPrincipal(req, ["aos.create"]);
      const commandId = requireGovernedIdempotencyKey(req, "IXI_MACHINE_COMMAND_ID_REQUIRED");
      const result = provisionSharetribeMachine({
        entityId: principal.entityId,
        principalId: principal.principalId,
        commandId,
        creationBoundary: req.body?.creationBoundary || "authenticated-listing-admission.v1",
        listing: req.body?.listing || {}
      });

      return res.status(result.replayed ? 200 : 201).json({
        ...result,
        object: await objectWithEffectiveAuthority(req, result.object)
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);


router.post(
  "/objects/provision/:commandId/recover",
  async (req, res) => {
    try {
      const principal = governedPrincipal(req, ["aos.provision.recover"]);
      const result =
        recoverAosObjectProvisioning({
          commandId:
            req.params.commandId,

          entityId: principal.entityId,
          actorId: principal.principalId
        });

      return res.json({
        ...result,
        object: await objectWithEffectiveAuthority(req, result.object)
      });
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

async function objectWithEffectiveAuthority(req, object) {
  return {
    ...object,
    ...(await buildMosObjectActorAuthority({
      principal: req.ixiAuthorityPrincipal,
      object
    }))
  };
}

async function admitAuthorizedCanonicalIdentity(req, input = {}) {
  const entityId = String(
    req.ixiRequestContext?.entityId ||
    req.ixiAuthorityPrincipal?.entityId ||
    ""
  ).trim();

  if (!entityId) {
    throw new MosError(
      "CANONICAL_ADMISSION_AUTH_REQUIRED",
      "Canonical identity admission requires authenticated tenant context.",
      null,
      401
    );
  }

  const admission = resolveCanonicalObjectIdentity({
    entityId,
    objectId: input?.objectId,
    passportId: input?.passportId,
    aliases: input?.aliases,
    sourceType: input?.sourceType,
    sourceId: input?.sourceId
  });

  await assertMosObjectAuthority({
    principal: req.ixiAuthorityPrincipal,
    object: admission.object,
    capability: "aos.view"
  });

  return {
    identity: {
      objectId: admission.objectId,
      passportId: admission.passportId,
      entityId: admission.entityId,
      aliases: admission.aliases,
      evidence: admission.evidence
    },
    object: await objectWithEffectiveAuthority(req, admission.object)
  };
}

router.post(
  "/identity/admit",
  async (req, res) => {
    try {
      const admission = await admitAuthorizedCanonicalIdentity(req, req.body);

      return res.json({
        ok: true,
        ...admission
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/identity/admit-batch",
  async (req, res) => {
    try {
      const requests = Array.isArray(req.body?.requests)
        ? req.body.requests
        : [];

      if (!requests.length || requests.length > 250) {
        throw new MosError(
          "CANONICAL_ADMISSION_BATCH_INVALID",
          "Canonical identity batch admission requires between 1 and 250 requests.",
          null,
          400
        );
      }

      const admissions = [];
      for (const request of requests) {
        admissions.push(await admitAuthorizedCanonicalIdentity(req, request));
      }

      return res.json({
        ok: true,
        admissions
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.post("/objects", async (req, res) => {
  try {
    const principal = governedPrincipal(req, ["aos.create"]);
    const commandId = requireGovernedCommandId(req, "AOS_SAVE_COMMAND_ID_REQUIRED");
    const input = { ...(req.body || {}) };
    delete input.trustedPassportId;

    const result = provisionAosObject({
      ...input,
      commandId,
      entityId: principal.entityId,
      actorId: principal.principalId
    });
    const object = result.object;
    const authorizedObject = await objectWithEffectiveAuthority(req, object);

    rebuildEntityProjections(
      object.entityId
    );

    return res.status(result.replayed ? 200 : 201).json({
      ok: true,
      object: authorizedObject,
      passport: result.passport,
      replayed: result.replayed === true,
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

      const authorizedObject = await objectWithEffectiveAuthority(req, object);

      return res.json({
        ok: true,
        object: authorizedObject,
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
    let activeCommandId = "";
    let commandStarted = false;

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

      const bodyCommandId =
        String(
          req.body?.commandId ||
          ""
        ).trim();

      const idempotencyKey =
        String(
          req.headers[
            "idempotency-key"
          ] ||
          ""
        ).trim();

      if (
        !bodyCommandId ||
        !idempotencyKey ||
        bodyCommandId !==
          idempotencyKey
      ) {
        throw new MosError(
          "OBJECT_COMMAND_ID_REQUIRED",
          "A matching commandId and Idempotency-Key are required.",
          null,
          428
        );
      }

      activeCommandId =
        bodyCommandId;

      const bodyRevision =
        Number(
          req.body?.expectedRevision
        );

      const rawHeaderRevision =
        String(
          req.headers["if-match"] ||
          ""
        )
          .replace(/^W\//i, "")
          .replace(/^\"|\"$/g, "")
          .trim();

      const headerRevision =
        Number(rawHeaderRevision);

      if (
        !Number.isInteger(bodyRevision) ||
        bodyRevision < 0 ||
        !rawHeaderRevision ||
        !Number.isInteger(headerRevision) ||
        headerRevision !== bodyRevision
      ) {
        throw new MosError(
          "OBJECT_REVISION_REQUIRED",
          "Matching expectedRevision and If-Match values are required.",
          {
            expectedRevision:
              req.body?.expectedRevision,
            ifMatch:
              req.headers["if-match"] ||
              null
          },
          428
        );
      }

      const payloadHash =
        crypto
          .createHash("sha256")
          .update(
            JSON.stringify({
              objectId:
                req.params.objectId,
              body:
                req.body || {}
            })
          )
          .digest("hex");

      const command =
        beginCommand({
          commandId:
            activeCommandId,
          entityId:
            currentObject.entityId,
          commandType:
            "object.update",
          payloadHash
        });

      commandStarted =
        !command.duplicate;

      if (command.duplicate) {
        const record =
          command.record;

        if (
          record.entityId !==
            currentObject.entityId ||
          record.commandType !==
            "object.update" ||
          record.payloadHash !==
            payloadHash
        ) {
          throw new MosError(
            "OBJECT_COMMAND_REUSE_CONFLICT",
            "commandId was already used for a different Object mutation.",
            {
              commandId:
                activeCommandId
            },
            409
          );
        }

        if (
          record.status ===
            "completed" &&
          record.result
        ) {
          return res.json({
            ...record.result,
            replayed: true
          });
        }

        throw new MosError(
          "OBJECT_COMMAND_NOT_REPLAYABLE",
          "The prior Object command did not complete and cannot be replayed.",
          {
            commandId:
              activeCommandId,
            status:
              record.status
          },
          409
        );
      }

      const object =
        updateObject({
          ...(req.body || {}),

          objectId:
            req.params.objectId,

          actorId:
            trustedActorId,

          expectedRevision:
            bodyRevision,

          commandId:
            activeCommandId
        });

      rebuildEntityProjections(
        object.entityId
      );

      const result = {
        ok: true,

        object,

        branch:
          getBranchSummary(
            object.objectId
          )
      };

      completeCommand({
        commandId:
          activeCommandId,
        result
      });

      return res.json({
        ...result,
        replayed: false
      });
    } catch (error) {
      if (
        activeCommandId &&
        commandStarted
      ) {
        failCommand({
          commandId:
            activeCommandId,
          error
        });
      }

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

      const authorizedObjects = await Promise.all(
        discoverableObjects.map(object => objectWithEffectiveAuthority(req, object))
      );

      return res.json({
        ok: true,
        count:
          authorizedObjects.length,
        objects:
          authorizedObjects
      });
    } catch (error) {
      return sendMosError(
        res,
        error
      );
    }
  }
);

/* ---------- NEUTRAL OBJECT RELATIONSHIPS ---------- */

function authoritativeRelationshipEvidence(relationship, supplied = {}) {
  return buildRelationshipIdentityEvidence(relationship, supplied);
}

router.get(
  "/objects/:objectId/relationships",
  async (req, res) => {
    try {
      const object = getObject(req.params.objectId);
      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object,
        capability: "aos.view"
      });

      const related = listRelatedObjects({
        objectId: object.objectId,
        relationshipType: req.query.relationshipType || null,
        behaviorId: req.query.behaviorId || null,
        definitionId: req.query.definitionId || null,
        direction: req.query.direction || "both",
        status: req.query.status === "all" ? null : (req.query.status || "active")
      });
      const visibleObjects = await filterDiscoverableObjects({
        principal: req.ixiAuthorityPrincipal,
        objects: related.map(item => item.relatedObject).filter(Boolean)
      });
      const visibleIds = new Set(visibleObjects.map(item => item.objectId));
      const visibleRelationships = await Promise.all(related.filter(item =>
        item.relatedObject && visibleIds.has(item.relatedObject.objectId)
      ).map(async item => ({
        ...item,
        relatedObject: await objectWithEffectiveAuthority(req, item.relatedObject),
        relationship: decorateRelationshipWithIdentityEvidence(item.relationship),
        identityEvidence: authoritativeRelationshipEvidence(item.relationship)
      })));

      const authorizedRootObject = await objectWithEffectiveAuthority(req, object);

      return res.json({
        ok: true,
        object: authorizedRootObject,
        count: visibleRelationships.length,
        relationships: visibleRelationships
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.get(
  "/objects/:objectId/relationship-graph",
  async (req, res) => {
    try {
      const object = getObject(req.params.objectId);
      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object,
        capability: "aos.view"
      });

      const graph = traverseRelationships({
        objectId: object.objectId,
        relationshipTypes: String(req.query.relationshipTypes || "")
          .split(",")
          .map(value => value.trim())
          .filter(Boolean),
        behaviorIds: String(req.query.behaviorIds || "")
          .split(",")
          .map(value => value.trim())
          .filter(Boolean),
        direction: req.query.direction || "both",
        maxDepth: req.query.maxDepth || 4,
        maxObjects: req.query.maxObjects || 500,
        status: req.query.status === "all" ? null : (req.query.status || "active")
      });
      const visibleObjects = await filterDiscoverableObjects({
        principal: req.ixiAuthorityPrincipal,
        objects: graph.objects.map(item => item.object)
      });
      const visibleIds = new Set([
        object.objectId,
        ...visibleObjects.map(item => item.objectId)
      ]);

      const visibleEdges = graph.relationships.filter(relationship =>
        visibleIds.has(relationship.sourceObjectId) &&
        visibleIds.has(relationship.targetObjectId)
      );
      const graphDirection = ["incoming", "outgoing", "both"]
        .includes(String(req.query.direction || "both").toLowerCase())
          ? String(req.query.direction || "both").toLowerCase()
          : "both";
      const reachableIds = new Set([object.objectId]);
      let expanded = true;

      while (expanded) {
        expanded = false;
        visibleEdges.forEach(relationship => {
          const sourceReachable = reachableIds.has(relationship.sourceObjectId);
          const targetReachable = reachableIds.has(relationship.targetObjectId);

          if ((graphDirection === "outgoing" || graphDirection === "both") &&
              sourceReachable && !targetReachable) {
            reachableIds.add(relationship.targetObjectId);
            expanded = true;
          }
          if ((graphDirection === "incoming" || graphDirection === "both") &&
              targetReachable && !sourceReachable) {
            reachableIds.add(relationship.sourceObjectId);
            expanded = true;
          }
        });
      }

      const reachableObjects = graph.objects.filter(item =>
        reachableIds.has(item.object.objectId)
      );
      const reachableEdges = visibleEdges.filter(relationship =>
        reachableIds.has(relationship.sourceObjectId) &&
        reachableIds.has(relationship.targetObjectId)
      );
      const depthByObjectId = new Map([[object.objectId, 0]]);
      const depthQueue = [object.objectId];

      while (depthQueue.length) {
        const currentId = depthQueue.shift();
        const currentDepth = depthByObjectId.get(currentId);
        reachableEdges.forEach(relationship => {
          const nextIds = [];
          if ((graphDirection === "outgoing" || graphDirection === "both") &&
              relationship.sourceObjectId === currentId) {
            nextIds.push(relationship.targetObjectId);
          }
          if ((graphDirection === "incoming" || graphDirection === "both") &&
              relationship.targetObjectId === currentId) {
            nextIds.push(relationship.sourceObjectId);
          }
          nextIds.forEach(nextId => {
            if (!depthByObjectId.has(nextId)) {
              depthByObjectId.set(nextId, currentDepth + 1);
              depthQueue.push(nextId);
            }
          });
        });
      }

      const responseObjects = await Promise.all(reachableObjects.map(async item => ({
        object: await objectWithEffectiveAuthority(req, item.object),
        depth: depthByObjectId.get(item.object.objectId)
      })));

      const authorizedRootObject = await objectWithEffectiveAuthority(req, object);

      return res.json({
        ok: true,
        rootObject: authorizedRootObject,
        maxDepth: graph.maxDepth,
        maxObjects: graph.maxObjects,
        truncated: responseObjects.length >= graph.maxObjects,
        objects: responseObjects,
        relationships: reachableEdges.map(relationship => ({
          relationship: decorateRelationshipWithIdentityEvidence(relationship),
          identityEvidence: authoritativeRelationshipEvidence(relationship)
        }))
      });
    } catch (error) {
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/relationships",
  async (req, res) => {
    let activeCommandId = "";
    let commandStarted = false;

    try {
      const sourceCandidate = getObject(req.body?.sourceObjectId);
      const targetCandidate = getObject(req.body?.targetObjectId);
      const sourceAdmission = resolveCanonicalObjectIdentity({
        entityId: sourceCandidate.entityId,
        objectId: sourceCandidate.objectId,
        passportId: req.body?.sourcePassportId || ""
      });
      const targetAdmission = resolveCanonicalObjectIdentity({
        entityId: sourceCandidate.entityId,
        objectId: targetCandidate.objectId,
        passportId: req.body?.targetPassportId || ""
      });
      const sourceObject = sourceAdmission.object;
      const targetObject = targetAdmission.object;

      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object: sourceObject,
        capability: "aos.relationship.create"
      });
      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object: targetObject,
        capability: "aos.relationship.create"
      });

      const command = beginHttpCommand({
        req,
        entityId: sourceObject.entityId,
        commandType: "relationship.create",
        payload: {
          sourceObjectId: sourceObject.objectId,
          targetObjectId: targetObject.objectId,
          relationshipType: req.body?.relationshipType || req.body?.relationshipLabel,
          behaviorId: req.body?.behaviorId || null,
          definitionId: req.body?.definitionId || null,
          orderKey: req.body?.orderKey || null,
          effectiveFrom: req.body?.effectiveFrom || null,
          effectiveTo: req.body?.effectiveTo || null,
          metadata: req.body?.metadata || {}
        }
      });
      activeCommandId = command.commandId;
      commandStarted = !command.duplicate;

      if (command.duplicate) {
        return res.json({ ...command.result, replayed: true });
      }

      const trustedActorId = req.ixiAuthorityPrincipal?.principalId ||
        req.ixiRequestContext?.principalId || null;
      const relationshipResult = createObjectRelationship({
        relationshipType: req.body?.relationshipType,
        relationshipLabel: req.body?.relationshipLabel,
        behaviorId: req.body?.behaviorId,
        definitionId: req.body?.definitionId,
        orderKey: req.body?.orderKey,
        sourceObjectId: sourceObject.objectId,
        targetObjectId: targetObject.objectId,
        actorId: trustedActorId,
        commandId: activeCommandId,
        effectiveFrom: req.body?.effectiveFrom,
        effectiveTo: req.body?.effectiveTo,
        metadata: req.body?.metadata || {}
      });
      const result = {
        ...relationshipResult,
        sourceObject: await objectWithEffectiveAuthority(req, sourceObject),
        targetObject: await objectWithEffectiveAuthority(req, targetObject),
        relationship: decorateRelationshipWithIdentityEvidence(
          relationshipResult.relationship,
          {
            sourcePassportId: sourceAdmission.passportId,
            targetPassportId: targetAdmission.passportId
          }
        ),
        identityEvidence: authoritativeRelationshipEvidence(
          relationshipResult.relationship,
          {
            sourcePassportId: sourceAdmission.passportId,
            targetPassportId: targetAdmission.passportId
          }
        )
      };
      const response = { ok: true, result };
      completeCommand({ commandId: activeCommandId, result: response });
      return res.status(result.changed ? 201 : 200).json({ ...response, replayed: false });
    } catch (error) {
      if (activeCommandId && commandStarted) {
        failCommand({ commandId: activeCommandId, error });
      }
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/relationships/:relationshipId/end",
  async (req, res) => {
    let activeCommandId = "";
    let commandStarted = false;

    try {
      const current = getRelationship(req.params.relationshipId);
      const sourceCandidate = getObject(current.sourceObjectId);
      const targetCandidate = getObject(current.targetObjectId);
      const sourceAdmission = resolveCanonicalObjectIdentity({
        entityId: current.entityId,
        objectId: sourceCandidate.objectId,
        passportId: req.body?.sourcePassportId || ""
      });
      const targetAdmission = resolveCanonicalObjectIdentity({
        entityId: current.entityId,
        objectId: targetCandidate.objectId,
        passportId: req.body?.targetPassportId || ""
      });
      const sourceObject = sourceAdmission.object;
      const targetObject = targetAdmission.object;

      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object: sourceObject,
        capability: "aos.relationship.end"
      });
      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object: targetObject,
        capability: "aos.relationship.end"
      });

      const bodyRevision = Number(req.body?.expectedRevision);
      const rawHeaderRevision = String(req.headers["if-match"] || "")
        .replace(/^W\//i, "")
        .replace(/^\"|\"$/g, "")
        .trim();
      const headerRevision = Number(rawHeaderRevision);
      if (!Number.isInteger(bodyRevision) || !rawHeaderRevision ||
          !Number.isInteger(headerRevision) || headerRevision !== bodyRevision) {
        throw new MosError(
          "RELATIONSHIP_REVISION_REQUIRED",
          "Matching expectedRevision and If-Match values are required.",
          { expectedRevision: req.body?.expectedRevision, ifMatch: req.headers["if-match"] || null },
          428
        );
      }

      const command = beginHttpCommand({
        req,
        entityId: current.entityId,
        commandType: "relationship.end",
        payload: {
          relationshipId: current.relationshipId,
          expectedRevision: bodyRevision,
          effectiveTo: req.body?.effectiveTo || null,
          reason: req.body?.reason || null,
          metadata: req.body?.metadata || {}
        }
      });
      activeCommandId = command.commandId;
      commandStarted = !command.duplicate;

      if (command.duplicate) {
        return res.json({ ...command.result, replayed: true });
      }

      const trustedActorId = req.ixiAuthorityPrincipal?.principalId ||
        req.ixiRequestContext?.principalId || null;
      const relationshipResult = endObjectRelationship({
        relationshipId: current.relationshipId,
        expectedRevision: bodyRevision,
        actorId: trustedActorId,
        commandId: activeCommandId,
        reason: req.body?.reason,
        effectiveTo: req.body?.effectiveTo,
        metadata: req.body?.metadata || {}
      });
      const result = {
        ...relationshipResult,
        relationship: decorateRelationshipWithIdentityEvidence(
          relationshipResult.relationship,
          {
            sourcePassportId: sourceAdmission.passportId,
            targetPassportId: targetAdmission.passportId
          }
        ),
        identityEvidence: authoritativeRelationshipEvidence(
          relationshipResult.relationship,
          {
            sourcePassportId: sourceAdmission.passportId,
            targetPassportId: targetAdmission.passportId
          }
        )
      };
      const response = { ok: true, result };
      completeCommand({ commandId: activeCommandId, result: response });
      return res.json({ ...response, replayed: false });
    } catch (error) {
      if (activeCommandId && commandStarted) {
        failCommand({ commandId: activeCommandId, error });
      }
      return sendMosError(res, error);
    }
  }
);

router.post(
  "/relationships/:relationshipId/order",
  async (req, res) => {
    let activeCommandId = "";
    let commandStarted = false;

    try {
      const current = getRelationship(req.params.relationshipId);
      const sourceAdmission = resolveCanonicalObjectIdentity({
        entityId: current.entityId,
        objectId: current.sourceObjectId,
        passportId: req.body?.sourcePassportId || ""
      });
      const targetAdmission = resolveCanonicalObjectIdentity({
        entityId: current.entityId,
        objectId: current.targetObjectId,
        passportId: req.body?.targetPassportId || ""
      });
      const sourceObject = sourceAdmission.object;
      const targetObject = targetAdmission.object;

      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object: sourceObject,
        capability: "aos.relationship.order"
      });
      await assertMosObjectAuthority({
        principal: req.ixiAuthorityPrincipal,
        object: targetObject,
        capability: "aos.relationship.order"
      });

      const bodyRevision = Number(req.body?.expectedRevision);
      const rawHeaderRevision = String(req.headers["if-match"] || "")
        .replace(/^W\//i, "")
        .replace(/^\"|\"$/g, "")
        .trim();
      const headerRevision = Number(rawHeaderRevision);
      if (!Number.isInteger(bodyRevision) || !rawHeaderRevision ||
          !Number.isInteger(headerRevision) || headerRevision !== bodyRevision) {
        throw new MosError(
          "RELATIONSHIP_REVISION_REQUIRED",
          "Matching expectedRevision and If-Match values are required.",
          { expectedRevision: req.body?.expectedRevision, ifMatch: req.headers["if-match"] || null },
          428
        );
      }

      const command = beginHttpCommand({
        req,
        entityId: current.entityId,
        commandType: "relationship.order",
        payload: {
          relationshipId: current.relationshipId,
          expectedRevision: bodyRevision,
          orderKey: req.body?.orderKey || null
        }
      });
      activeCommandId = command.commandId;
      commandStarted = !command.duplicate;

      if (command.duplicate) {
        return res.json({ ...command.result, replayed: true });
      }

      const relationshipResult = updateObjectRelationshipOrder({
        relationshipId: current.relationshipId,
        expectedRevision: bodyRevision,
        orderKey: req.body?.orderKey,
        actorId: req.ixiAuthorityPrincipal?.principalId ||
          req.ixiRequestContext?.principalId || null,
        commandId: activeCommandId
      });
      const result = {
        ...relationshipResult,
        relationship: decorateRelationshipWithIdentityEvidence(
          relationshipResult.relationship,
          {
            sourcePassportId: sourceAdmission.passportId,
            targetPassportId: targetAdmission.passportId
          }
        ),
        identityEvidence: authoritativeRelationshipEvidence(
          relationshipResult.relationship,
          {
            sourcePassportId: sourceAdmission.passportId,
            targetPassportId: targetAdmission.passportId
          }
        )
      };
      const response = { ok: true, result };
      completeCommand({ commandId: activeCommandId, result: response });
      return res.json({ ...response, replayed: false });
    } catch (error) {
      if (activeCommandId && commandStarted) {
        failCommand({ commandId: activeCommandId, error });
      }
      return sendMosError(res, error);
    }
  }
);

/* ---------- LEGACY EXCLUSIVE CONTAINMENT ---------- */

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
      assertLegacyContainmentWriteEnabled();

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
      assertLegacyContainmentWriteEnabled();

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
