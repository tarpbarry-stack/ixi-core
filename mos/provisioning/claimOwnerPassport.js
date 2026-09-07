#!/usr/bin/env node
"use strict";

const {
  listOwnerPassportCandidates,
  claimOwnerPassport
} = require("./aosOwnerPassportClaimService");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const principalId = argument("--principal");
const requestedPassportId = argument("--passport");
const apply = process.argv.includes("--apply");

if (!principalId || !requestedPassportId) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    instruction: "Select the exact principal, then rerun with --principal, --passport and --apply.",
    candidates: listOwnerPassportCandidates()
  }, null, 2));
  process.exit(0);
}

if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    requestedPassportId,
    selected: listOwnerPassportCandidates().filter(candidate =>
      candidate.principalId === principalId
    )
  }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify(claimOwnerPassport({
  principalId,
  requestedPassportId,
  actorId: `passport-claim:${principalId}`
}), null, 2));
