// /acquisition/identity/resolveMachineModel.js

const {
  normalizeIdentityValue
} = require("./normalizeIdentity");

const {
  canonicalizeModel
} = require("./canonicalizeModel");

const {
  applyManufacturerGrammar
} = require("./Grammar/applyManufacturerGrammar");

function sameModel(a = "", b = "") {
  return (
    normalizeIdentityValue(
      canonicalizeModel(a)
    ) ===
    normalizeIdentityValue(
      canonicalizeModel(b)
    )
  );
}

function resolveMachineModel(input = {}) {
  const rawModel =
    String(input.model || "").trim();

  const make =
    String(input.make || "").trim();

  const knownModels =
    Array.isArray(input.knownModels)
      ? input.knownModels
      : [];

  const grammarResolution =
    applyManufacturerGrammar({
      make,
      model: rawModel,
      knownModels
    });

  const model =
    String(
      grammarResolution?.model ||
      canonicalizeModel(rawModel) ||
      ""
    ).trim();

  const exactMatch =
    knownModels.find(item =>
      sameModel(item, model)
    );

  if (exactMatch) {
    return {
      model: exactMatch,
      rawModel,
      canonicalModel: exactMatch,
      grammarResolution,

      action:
        rawModel === exactMatch
          ? "existing-model"
          : "normalized-to-existing-model",

      taxonomyRuntimeStatus: {
        runtimeAccepted: true,
        modelCreatedNow: false,
        modelAlreadyExisted: true,
        frontendShouldRefreshTaxonomy: false,
        queuedForAdmin: false
      },

      auditEvent: null,
      queuedChange: null
    };
  }

  return {
    model,
    rawModel,
    canonicalModel: model,
    grammarResolution,

    action: model
      ? "accepted-model-for-runtime-taxonomy"
      : "missing-model",

    taxonomyRuntimeStatus: {
      runtimeAccepted: Boolean(model),
      modelCreatedNow: false,
      modelAlreadyExisted: false,
      frontendShouldRefreshTaxonomy: false,
      queuedForAdmin: false
    },

    auditEvent: null,
    queuedChange: null
  };
}

module.exports = {
  resolveMachineModel
};
