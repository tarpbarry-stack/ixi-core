const {
  firstString,
  normalizeDateTime
} = require("./auctionIdentityUtils");

function calculateTimingState({
  startsAt,
  scheduledCloseAt,
  endsAt,
  actualCloseAt,
  now = new Date()
}) {
  const nowMs =
    now.getTime();

  const startMs =
    startsAt
      ? Date.parse(startsAt)
      : NaN;

  const closeCandidate =
    scheduledCloseAt ||
    actualCloseAt ||
    endsAt;

  const closeMs =
    closeCandidate
      ? Date.parse(closeCandidate)
      : NaN;

  const future =
    Number.isFinite(startMs) &&
    nowMs < startMs;

  const closed =
    Number.isFinite(closeMs) &&
    nowMs >= closeMs;

  const live =
    !future &&
    !closed &&
    (
      Number.isFinite(startMs) ||
      Number.isFinite(closeMs)
    );

  return {
    future,
    live,
    closed
  };
}

function normalizeAuctionTiming({
  evidence = {},
  event = {},
  lot = {},
  now
} = {}) {
  const startsAt =
    normalizeDateTime(
      firstString(
        lot.startsAt,
        evidence.startsAt,
        event.startsAt
      )
    );

  const endsAt =
    normalizeDateTime(
      firstString(
        evidence.endsAt,
        event.endsAt
      )
    );

  const scheduledCloseAt =
    normalizeDateTime(
      firstString(
        lot.scheduledCloseAt,
        evidence.scheduledCloseAt,
        evidence.lotCloseAt
      )
    );

  const actualCloseAt =
    normalizeDateTime(
      firstString(
        lot.actualCloseAt,
        evidence.actualCloseAt
      )
    );

  const state =
    calculateTimingState({
      startsAt,
      scheduledCloseAt,
      endsAt,
      actualCloseAt,
      now
    });

  return {
    timezone:
      firstString(
        lot.timezone,
        event.timezone,
        evidence.timezone
      ),

    startsAt,

    endsAt,

    scheduledCloseAt,

    actualCloseAt,

    extendedUntil:
      normalizeDateTime(
        firstString(
          evidence.extendedUntil,
          evidence.lot?.extendedUntil
        )
      ),

    updatedAt:
      normalizeDateTime(
        firstString(
          evidence.updatedAt,
          evidence.scrapedAt
        )
      ),

    ...state
  };
}

module.exports = {
  normalizeAuctionTiming,
  calculateTimingState
};
