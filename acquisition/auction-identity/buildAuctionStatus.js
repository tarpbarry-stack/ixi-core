const {
  firstString,
  normalizeBoolean,
  normalizeLower
} = require("./auctionIdentityUtils");

function buildAuctionStatus({
  evidence = {},
  lot = {},
  event = {},
  timing = {}
} = {}) {
  const rawStatus =
    firstString(
      lot.status,
      evidence.status,
      evidence.bidStatus,
      event.status
    );

  const normalized =
    normalizeLower(rawStatus);

  const sold =
    normalizeBoolean(
      evidence.sold ??
      lot.sold ??
      (
        /\bsold\b/.test(normalized)
          ? true
          : null
      )
    );

  const pending =
    timing.future ||
    /\bupcoming\b|\bpending\b|\bnot started\b/.test(
      normalized
    );

  const closed =
    timing.closed ||
    sold === true ||
    /\bclosed\b|\bended\b|\bcomplete\b|\bunsold\b/.test(
      normalized
    );

  const live =
    !closed &&
    (
      timing.live ||
      /\blive\b|\bopen\b|\bbidding\b|\bin progress\b/.test(
        normalized
      )
    );

  const extended =
    Boolean(
      timing.extendedUntil ||
      /\bextended\b/.test(normalized)
    );

  let value =
    normalized || "unknown";

  if (sold === true) {
    value = "sold";
  } else if (closed) {
    value = "closed";
  } else if (live) {
    value = "live";
  } else if (pending) {
    value = "pending";
  }

  return {
    value,
    raw:
      rawStatus,

    live,
    closed,
    pending,
    sold,
    extended
  };
}

module.exports = {
  buildAuctionStatus
};
