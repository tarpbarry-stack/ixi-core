const lyonAuctionDoctrine =
  require("./companies/lyonAuction");

const nativePlatform =
  require("./platforms/native");

const proxibidPlatform =
  require("./platforms/proxibid");

const equipmentFactsPlatform =
  require("./platforms/equipmentFacts");

const COMPANY_DOCTRINES = {
  "lyon-auction": lyonAuctionDoctrine
};

const PLATFORM_DOCTRINES = {
  native: nativePlatform,
  proxibid: proxibidPlatform,
  equipmentfacts: equipmentFactsPlatform
};

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(
        ([key, item]) => [key, clone(item)]
      )
    );
  }

  return value;
}

/*
 * Right-side values override left-side values.
 *
 * Empty strings, nulls and empty arrays from an incoming
 * listing do not erase populated doctrine values.
 *
 * This allows:
 *
 * company doctrine
 *   + platform overlay
 *   + event/listing facts
 *
 * while preserving real listing-specific overrides.
 */
function mergeDoctrine(base, incoming) {
  if (Array.isArray(base) || Array.isArray(incoming)) {
    if (
      Array.isArray(incoming) &&
      incoming.length
    ) {
      return clone(incoming);
    }

    return clone(
      Array.isArray(base)
        ? base
        : incoming
    );
  }

  if (
    isPlainObject(base) ||
    isPlainObject(incoming)
  ) {
    const result = {};

    const keys = new Set([
      ...Object.keys(
        isPlainObject(base) ? base : {}
      ),
      ...Object.keys(
        isPlainObject(incoming) ? incoming : {}
      )
    ]);

    for (const key of keys) {
      const baseValue =
        isPlainObject(base)
          ? base[key]
          : undefined;

      const incomingValue =
        isPlainObject(incoming)
          ? incoming[key]
          : undefined;

      if (
        incomingValue === undefined ||
        incomingValue === null ||
        incomingValue === ""
      ) {
        result[key] = clone(baseValue);
        continue;
      }

      if (
        Array.isArray(incomingValue) &&
        incomingValue.length === 0
      ) {
        result[key] = clone(baseValue);
        continue;
      }

      result[key] =
        mergeDoctrine(
          baseValue,
          incomingValue
        );
    }

    return result;
  }

  if (
    incoming === undefined ||
    incoming === null ||
    incoming === ""
  ) {
    return clone(base);
  }

  return clone(incoming);
}

function normalizeCompanyId(value = "") {
  const id =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    id === "lyon" ||
    id === "alex-lyon" ||
    id === "alex-lyon-son"
  ) {
    return "lyon-auction";
  }

  return id;
}

function normalizePlatformId(value = "") {
  const id =
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");

  if (
    id === "lyon-auction" ||
    id === "lyon-live" ||
    id === "lyonauctionlive" ||
    id === "nextlot"
  ) {
    return "native";
  }

  if (
    id === "equipment-facts" ||
    id === "equipmentfacts"
  ) {
    return "equipmentfacts";
  }

  return id || "native";
}

function applyAuctionDoctrine({
  auction = {},
  companyId = "",
  platformId = ""
} = {}) {
  const resolvedCompanyId =
    normalizeCompanyId(
      companyId ||
      auction?.company?.id ||
      auction?.provider
    );

  const resolvedPlatformId =
    normalizePlatformId(
      platformId ||
      auction?.platform
    );

  const companyDoctrine =
    COMPANY_DOCTRINES[resolvedCompanyId] ||
    {};

  const platformDoctrine =
    PLATFORM_DOCTRINES[resolvedPlatformId] ||
    {};

  /*
   * Merge order:
   *
   * 1. Company doctrine provides stable defaults.
   * 2. Platform doctrine adds platform-specific fees.
   * 3. Parsed auction wins when it contains real values.
   */
  const doctrineTerms =
    mergeDoctrine(
      companyDoctrine.terms || {},
      platformDoctrine.terms || {}
    );

  const resolvedTerms =
    mergeDoctrine(
      doctrineTerms,
      auction.terms || {}
    );

  const doctrineRules =
    mergeDoctrine(
      companyDoctrine.auctionRules || {},
      platformDoctrine.auctionRules || {}
    );

  const resolvedRules =
    mergeDoctrine(
      doctrineRules,
      auction.auctionRules || {}
    );

  return {
    ...auction,

    company: {
      ...(companyDoctrine.company || {}),
      ...(auction.company || {})
    },

    platform:
      auction.platform ||
      resolvedPlatformId,

    terms: resolvedTerms,

    auctionRules: {
      ...resolvedRules,

      doctrineResolution: {
        companyId:
          resolvedCompanyId,

        platformId:
          resolvedPlatformId,

        companyDoctrineApplied:
          Boolean(
            COMPANY_DOCTRINES[
              resolvedCompanyId
            ]
          ),

        platformDoctrineApplied:
          Boolean(
            PLATFORM_DOCTRINES[
              resolvedPlatformId
            ]
          ),

        resolvedAt:
          new Date().toISOString()
      }
    }
  };
}

module.exports = {
  applyAuctionDoctrine,
  mergeDoctrine,
  normalizeCompanyId,
  normalizePlatformId
};
