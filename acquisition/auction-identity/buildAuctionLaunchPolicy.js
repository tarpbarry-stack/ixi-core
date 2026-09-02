const {
  firstString,
  normalizeLower
} = require("./auctionIdentityUtils");

function buildAuctionLaunchPolicy({
  sale = {},
  importAuthority,
  requestedDestination
} = {}) {
  const authority =
    normalizeLower(
      firstString(
        importAuthority,
        "unknown"
      )
    );

  const requested =
    normalizeLower(
      firstString(
        requestedDestination
      )
    );

  if (sale.type === "auction") {
    return {
      forcedDestination:
        "auction",

      allowedDestinations: [
        "auction"
      ],

      destinationLocked:
        true,

      reason:
        "Source page is classified as an auction lot",

      importAuthority:
        authority
    };
  }

  if (
    [
      "owner",
      "authorized",
      "owner-or-authorized"
    ].includes(authority)
  ) {
    return {
      forcedDestination:
        "",

      allowedDestinations: [
        "live",
        "private"
      ],

      destinationLocked:
        false,

      defaultDestination:
        requested === "private"
          ? "private"
          : "live",

      reason:
        "Owner or authorized representative may publish fixed-price inventory",

      importAuthority:
        authority
    };
  }

  return {
    forcedDestination:
      "private",

    allowedDestinations: [
      "private"
    ],

    destinationLocked:
      true,

    reason:
      "Third-party or unverified fixed-price import remains private",

    importAuthority:
      authority
  };
}

module.exports = {
  buildAuctionLaunchPolicy
};
