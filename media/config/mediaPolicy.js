const PLATFORM_MODE =
  process.env.IXI_MEDIA_PLATFORM_MODE ||
  "demo";

const SOURCE_POLICIES = {
  rbauction: {
    demo: {
      selectionMode: "all",
      maximumPhotos: null
    },

    production: {
      selectionMode: "ixi-best",
      maximumPhotos: 12
    }
  },

  ironplanet: {
    demo: {
      selectionMode: "all",
      maximumPhotos: null
    },

    production: {
      selectionMode: "ixi-best",
      maximumPhotos: 12
    }
  },

  "sandhills-inventory": {
    demo: {
      selectionMode: "all",
      maximumPhotos: null
    },

    production: {
      selectionMode: "ixi-best",
      maximumPhotos: 16
    }
  },

  default: {
    demo: {
      selectionMode: "all",
      maximumPhotos: null
    },

    production: {
      selectionMode: "ixi-best",
      maximumPhotos: 20
    }
  }
};

function normalizeSourceType(sourceType = "") {
  return String(sourceType || "")
    .trim()
    .toLowerCase();
}

function normalizePlatformMode(mode = "") {
  const normalized =
    String(mode || "")
      .trim()
      .toLowerCase();

  return normalized === "production"
    ? "production"
    : "demo";
}

function getMediaPolicy(
  sourceType = "",
  requestedSelectionMode = ""
) {
  const normalizedSource =
    normalizeSourceType(sourceType);

  const platformMode =
    normalizePlatformMode(
      PLATFORM_MODE
    );

  const sourcePolicy =
    SOURCE_POLICIES[normalizedSource] ||
    SOURCE_POLICIES.default;

  const basePolicy =
    sourcePolicy[platformMode] ||
    sourcePolicy.demo;

  const requestedMode =
    String(
      requestedSelectionMode || ""
    )
      .trim()
      .toLowerCase();

  if (requestedMode === "all") {
    return {
      selectionMode: "all",
      maximumPhotos: null,
      platformMode
    };
  }

  if (requestedMode === "ixi-best") {
    return {
      selectionMode: "ixi-best",
      maximumPhotos:
        sourcePolicy.production
          ?.maximumPhotos || 12,
      platformMode
    };
  }

  return {
    ...basePolicy,
    platformMode
  };
}

function applyMediaPolicy({
  sourceType,
  imageUrls = [],
  selectionMode = ""
} = {}) {
  const policy =
    getMediaPolicy(
      sourceType,
      selectionMode
    );

  const cleanUrls =
    Array.from(
      new Set(
        imageUrls
          .map(url =>
            String(url || "").trim()
          )
          .filter(Boolean)
      )
    );

  const selectedUrls =
    policy.maximumPhotos === null
      ? cleanUrls
      : cleanUrls.slice(
          0,
          policy.maximumPhotos
        );

  return {
    policy,

    platformMode:
      policy.platformMode,

    selectionMode:
      policy.selectionMode,

    sourcePhotoCount:
      cleanUrls.length,

    selectedPhotoCount:
      selectedUrls.length,

    importedPhotoCount:
      selectedUrls.length,

    selectedUrls
  };
}

module.exports = {
  PLATFORM_MODE,
  SOURCE_POLICIES,
  normalizeSourceType,
  normalizePlatformMode,
  getMediaPolicy,
  applyMediaPolicy
};
