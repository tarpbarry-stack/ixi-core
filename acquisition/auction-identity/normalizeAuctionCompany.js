const {
  firstString,
  normalizeIdPart,
  normalizeUpper,
  uniqueStrings
} = require("./auctionIdentityUtils");

const COMPANY_ALIASES = [
  {
    id: "ritchie-bros",
    canonicalName: "RITCHIE BROS.",
    aliases: [
      "RITCHIE BROS",
      "RITCHIE BROTHERS",
      "RBA",
      "RB AUCTION",
      "RB GLOBAL"
    ]
  },
  {
    id: "ironplanet",
    canonicalName: "IRONPLANET",
    aliases: [
      "IRON PLANET",
      "IRONPLANET"
    ]
  },
  {
    id: "alex-lyon-son",
    canonicalName: "ALEX LYON & SON",
    aliases: [
      "ALEX LYON",
      "ALEX LYON AND SON",
      "LYON AUCTION",
      "LYON AUCTIONS"
    ]
  },
  {
    id: "purple-wave",
    canonicalName: "PURPLE WAVE",
    aliases: [
      "PURPLEWAVE",
      "PURPLE WAVE AUCTION"
    ]
  },
  {
    id: "proxibid",
    canonicalName: "PROXIBID",
    aliases: [
      "PROXIBID"
    ]
  },
  {
    id: "auctiontime",
    canonicalName: "AUCTIONTIME",
    aliases: [
      "AUCTION TIME",
      "AUCTIONTIME"
    ]
  },
  {
    id: "bidspotter",
    canonicalName: "BIDSPOTTER",
    aliases: [
      "BID SPOTTER",
      "BIDSPOTTER"
    ]
  },
  {
    id: "yoder-frey",
    canonicalName: "YODER & FREY",
    aliases: [
      "YODER AND FREY",
      "YODER & FREY"
    ]
  }
];

function findKnownCompany(name) {
  const normalized =
    normalizeUpper(name);

  if (!normalized) {
    return null;
  }

  return COMPANY_ALIASES.find(company =>
    company.aliases.some(alias =>
      normalized === normalizeUpper(alias) ||
      normalized.includes(
        normalizeUpper(alias)
      )
    )
  ) || null;
}

function normalizeAuctionCompany(
  evidence = {}
) {
  const rawName =
    firstString(
      evidence.company?.canonicalName,
      evidence.company?.name,
      evidence.companyName,
      evidence.auctionCompany,
      evidence.auctionHouseName,
      evidence.sellerName,
      evidence.event?.companyName
    );

  const known =
    findKnownCompany(rawName);

  const canonicalName =
    known?.canonicalName ||
    normalizeUpper(rawName);

  const sourceId =
    firstString(
      evidence.company?.sourceId,
      evidence.companyId,
      evidence.sourceAuctionHouseId,
      evidence.auctionHouseId
    );

  const id =
    firstString(
      evidence.company?.id,
      known?.id,
      sourceId
        ? `source-${normalizeIdPart(sourceId)}`
        : "",
      canonicalName
        ? normalizeIdPart(canonicalName)
        : ""
    );

  return {
    id,

    sourceId,

    canonicalName,

    displayName:
      firstString(
        evidence.company?.displayName,
        rawName,
        canonicalName
      ),

    aliases:
      uniqueStrings([
        rawName,
        ...(known?.aliases || []),
        ...(evidence.company?.aliases || [])
      ]),

    website:
      firstString(
        evidence.company?.website,
        evidence.companyUrl,
        evidence.auctionHouseUrl
      ),

    logoUrl:
      firstString(
        evidence.company?.logoUrl,
        evidence.companyLogoUrl,
        evidence.auctionHouseLogoUrl
      )
  };
}

module.exports = {
  normalizeAuctionCompany,
  COMPANY_ALIASES
};
