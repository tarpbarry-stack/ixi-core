const {
  categoryEvidenceEngine
} = require("./Evidence/categoryEvidenceEngine");

const {
  resolveMachineIdentity
} = require("./resolveMachineIdentity");

function buildIdentityEngineResult(input = {}) {
  const resolution = resolveMachineIdentity({
    category: input.category || "",
    make: input.make || "",
    model: input.model || ""
  });

  const categoryEvidence = categoryEvidenceEngine({
    parserCategory: input.category || "",
    sourceCategory: input.sourceCategory || "",
    title: input.title || "",
    description: input.description || "",
    url: input.url || "",
    make: input.make || "",
    model: input.model || "",
    identityResolution: resolution
  });

  const finalCategory =
    categoryEvidence?.winner?.category ||
    resolution.category ||
    input.category ||
    "";

  const finalMake =
    resolution.make || input.make || "";

  const finalModel =
    resolution.model || input.model || "";

  const finalResolution = {
    ...resolution,
    category: finalCategory,
    make: finalMake,
    model: finalModel
  };

  return {
    ok: true,

    taxonomyRuntimeStatus:
      resolution.modelResolution?.taxonomyRuntimeStatus || {
        runtimeAccepted: false,
        modelCreatedNow: false,
        modelAlreadyExisted: false,
        frontendShouldRefreshTaxonomy: false,
        queuedForAdmin: false
      },

    input: {
      category: input.category || "",
      make: input.make || "",
      model: input.model || ""
    },

    resolved: {
      category: finalCategory,
      make: finalMake,
      model: finalModel
    },

    confidence: resolution.confidence || "low",
    action: resolution.action || "unknown",

    categoryEvidence,

    makeResolution: resolution.makeResolution || null,
    modelResolution: resolution.modelResolution || null,

    raw: {
      make: resolution.rawMake || input.make || "",
      model: resolution.rawModel || input.model || ""
    },

    identityResolution: finalResolution
  };
}

module.exports = {
  buildIdentityEngineResult
};
