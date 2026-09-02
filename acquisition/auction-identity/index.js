const {
  classifySale
} = require("./classifySale");

const {
  collectAuctionEvidence
} = require("./collectAuctionEvidence");

const {
  normalizeAuctionCompany
} = require("./normalizeAuctionCompany");

const {
  normalizeAuctionEvent
} = require("./normalizeAuctionEvent");

const {
  normalizeAuctionLot
} = require("./normalizeAuctionLot");

const {
  normalizeAuctionTiming
} = require("./normalizeAuctionTiming");

const {
  buildAuctionStatus
} = require("./buildAuctionStatus");

const {
  buildAuctionLaunchPolicy
} = require("./buildAuctionLaunchPolicy");

const {
  buildAuctionObject
} = require("./buildAuctionObject");

module.exports = {
  classifySale,
  collectAuctionEvidence,
  normalizeAuctionCompany,
  normalizeAuctionEvent,
  normalizeAuctionLot,
  normalizeAuctionTiming,
  buildAuctionStatus,
  buildAuctionLaunchPolicy,
  buildAuctionObject
};
