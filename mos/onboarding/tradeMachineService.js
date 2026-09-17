"use strict";

const crypto = require("crypto");
const { mosDataPath } = require("../storage/mosPaths");
const { readJsonFile, updateJsonFile } = require("../storage/jsonStore");
const {
  resolveCanonicalObjectIdentity,
} = require("../identity/canonicalObjectAdmissionService");
const {
  provisionSharetribeMachine,
} = require("./sharetribeMachineProvisioningService");
const { ensureOwnedMachineEquipmentMembership } = require("./ownedMachineEquipmentMembershipService");
const {
  resolveEntityPassport,
} = require("../../identity/IXIPassportIdentityBridge");
const { MosError } = require("../errors/MosError");
const clean = (value) => String(value ?? "").trim();
const storePath = mosDataPath("trade-machines.json");
const fail = (message) => {
  throw new MosError("TRADE_MACHINE_CONFLICT", message, null, 409);
};
const keyOf = (entityId, dealId, tradeId) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([entityId, dealId, tradeId]))
    .digest("hex");

function scope(input) {
  const { entityId, principalId, dealId, outgoingPassportId } = input;
  if (
    ![entityId, principalId, dealId, outgoingPassportId].every((value) =>
      clean(value),
    )
  )
    fail("Entity, operator, deal, and outgoing machine are required.");
  const identity = resolveCanonicalObjectIdentity({
    entityId,
    passportId: outgoingPassportId,
  });
  if (identity.object.objectType !== "machine")
    fail("The deal must reference a canonical machine.");
}

async function listTradeMachines(input) {
  scope(input);
  const rows = Object.values(readJsonFile(storePath, {})).filter(
    (row) =>
      row.entityId === input.entityId &&
      row.dealId === input.dealId &&
      row.outgoingPassportId === input.outgoingPassportId,
  );
  // Recover an acquisition saved before its browser acknowledgement. This read
  // never promotes ownership; Finish Inventory still verifies the saved record.
  for (let index = 0; index < rows.length; index += 4) {
    await Promise.all(
      rows.slice(index, index + 4).map(async (row) => {
        if (!row.passportId || row.acquisitionId) return;
        const acquisitionId =
          require("../../financial/IXIFinancialTradeContract").tradeAcquisitionId(
            {
              context: {
                entityPassportId: resolveEntityPassport(row.entityId)
                  .entityPassportId,
              },
              trade: row,
            },
          );
        try {
          await loadVerifiedAcquisition(row, acquisitionId);
          Object.assign(row, {
            acquisitionId,
            status: "acquired",
            inventoryStatus: "pending",
          });
        } catch {
          /* No confirmed acquisition to expose; stable create identity remains recoverable. */
        }
      }),
    );
  }
  return rows;
}

function verifiedOrderTrades(order) {
  const candidates = Object.values(readJsonFile(storePath, {}));
  return (order.trades || []).map((trade) => {
    const row = candidates.find(
      (item) =>
        item.dealId === order.identity?.dealId &&
        item.tradeId === trade.tradeId &&
        item.outgoingPassportId === order.context?.primaryPassportId,
    );
    if (
      !row ||
      row.passportId !== trade.passportId ||
      row.objectId !== trade.objectId ||
      row.listingId !== trade.listingId ||
      row.allowanceCents !== Math.round(Number(trade.allowance) * 100) ||
      ["year", "make", "model", "serialNumber"].some(
        (field) => clean(row.machine[field]) !== clean(trade[field]),
      )
    )
      fail("Trade details must match the machine saved for this deal.");
    if (
      resolveEntityPassport(row.entityId).entityPassportId !==
      order.context?.entityPassportId
    )
      fail("Trade Entity does not match the sales order.");
    return row;
  });
}

function reserveTradeMachine(input) {
  scope(input);
  const tradeId = clean(input.tradeId);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(tradeId))
    fail("A stable trade identity is required.");
  const machine = input.machine || {};
  for (const field of ["year", "make", "model", "serialNumber"])
    if (!clean(machine[field])) fail(`Trade ${field} is required.`);
  if (!/^\d{4}$/.test(clean(machine.year)))
    fail("Enter the machine year as four digits.");
  if (
    !Number.isFinite(Number(machine.hours)) ||
    clean(machine.hours) === "" ||
    Number(machine.hours) < 0
  )
    fail("Trade hours must be zero or greater.");
  if (!Number.isSafeInteger(input.allowanceCents) || input.allowanceCents < 0)
    fail("Trade allowance must be a nonnegative money amount.");
  const data = {
    machine,
    allowanceCents: input.allowanceCents,
    existingListingId: clean(input.existingListingId),
    outgoingPassportId: input.outgoingPassportId,
  };
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  const key = keyOf(input.entityId, input.dealId, tradeId);
  let result;
  updateJsonFile(storePath, {}, (store) => {
    const existing = store[key];
    if (existing) {
      if (existing.principalId !== input.principalId)
        fail("Resume this unfinished trade with its original listing owner.");
      if (existing.fingerprint !== fingerprint)
        fail(
          "This trade was already saved with different details. Recover it before starting another trade.",
        );
      if (existing.status === "create-rejected") {
        existing.status = "listing-pending";
        existing.attemptId = crypto.randomUUID();
        result = { row: existing, createGranted: true };
      } else result = { row: existing, createGranted: false };
      return store;
    }
    if (
      !data.existingListingId &&
      Object.values(store).some(
        (item) =>
          item.entityId === input.entityId &&
          clean(item.machine?.serialNumber).toUpperCase() ===
            clean(machine.serialNumber).toUpperCase(),
      )
    )
      fail(
        "This serial already has a trade machine. Resume its save or select its existing card.",
      );
    const row = {
      ...data,
      tradeId,
      entityId: input.entityId,
      dealId: input.dealId,
      principalId: input.principalId,
      fingerprint,
      attemptId: crypto.randomUUID(),
      status: "listing-pending",
      listingId: clean(input.existingListingId),
      createdAt: new Date().toISOString(),
    };
    store[key] = row;
    result = { row, createGranted: !row.listingId };
    return store;
  });
  return result;
}

function rejectTradeListingCreate(input) {
  scope(input);
  if (![400, 401, 403, 422, 429].includes(input.statusCode))
    fail("An ambiguous creation must be recovered, not repeated.");
  const key = keyOf(input.entityId, input.dealId, input.tradeId);
  updateJsonFile(storePath, {}, (store) => {
    const row = store[key];
    if (
      !row ||
      row.principalId !== input.principalId ||
      row.attemptId !== input.attemptId ||
      row.listingId ||
      row.passportId
    )
      fail("This creation attempt cannot be released.");
    row.status = "create-rejected";
    return store;
  });
  return { retryable: true };
}

function completeTradeMachine(input) {
  scope(input);
  const key = keyOf(input.entityId, input.dealId, input.tradeId);
  const row = readJsonFile(storePath, {})[key];
  if (!row || row.outgoingPassportId !== input.outgoingPassportId)
    fail("Trade reservation was not found.");
  if (row.principalId !== input.principalId)
    fail("Resume this trade with its original listing owner.");
  const listing = input.listing || {};
  if (
    ["year", "make", "model", "serialNumber"].some(
      (field) =>
        clean(listing.fields?.[field]).toUpperCase() !==
        clean(row.machine[field]).toUpperCase(),
    )
  )
    fail(
      "The saved machine identity does not match this trade. Use its existing year, make, model, and serial.",
    );
  if (
    !clean(listing.listingId) ||
    (row.listingId && row.listingId !== listing.listingId)
  )
    fail("Trade listing identity changed.");
  let result;
  try {
    // Linking and retrying are identity reads. Listing edits and acquisition
    // ownership updates must not replay the original provisioning payload.
    result = resolveCanonicalObjectIdentity({
      entityId: input.entityId,
      objectId: row.objectId,
      passportId: row.passportId,
      aliases: [{ sourceType: "sharetribe-listing", sourceId: listing.listingId }],
    });
  } catch (error) {
    // Only a genuinely unbound listing may cross the existing creation boundary.
    // Conflicting, foreign, or incomplete bindings require explicit repair.
    if (error.code !== "CANONICAL_ALIAS_NOT_FOUND" || row.objectId || row.passportId) throw error;
    result = provisionSharetribeMachine({
      entityId: input.entityId,
      principalId: input.principalId,
      commandId: `sharetribe-listing:${listing.listingId}`,
      creationBoundary: "authenticated-listing-admission.v1",
      listing,
    });
  }
  if (result.object.objectType !== "machine")
    fail("The selected listing must resolve to a canonical machine.");
  if (result.passport.passportId === input.outgoingPassportId)
    fail("A machine cannot be traded for itself.");
  if (row.status === "acquired") {
    ensureOwnedMachineEquipmentMembership({
      entityId: input.entityId,
      principalId: input.principalId,
      listing,
      objectId: result.object.objectId,
      passportId: result.passport.passportId,
    });
  }
  let completed;
  updateJsonFile(storePath, {}, (store) => {
    const current = store[key];
    if (current.listingId && current.listingId !== listing.listingId)
      fail("This trade already has a different listing.");
    completed = {
      ...current,
      status: current.status === "acquired" ? "acquired" : "pending-trade",
      inventoryStatus:
        current.status === "acquired" && listing.ownership?.status === "owned"
          ? "complete"
          : "pending",
      listingId: listing.listingId,
      objectId: result.object.objectId,
      passportId: result.passport.passportId,
      updatedAt: new Date().toISOString(),
    };
    store[key] = completed;
    return store;
  });
  return { row: completed, object: result.object, passport: result.passport };
}

async function loadVerifiedAcquisition(row, acquisitionId) {
  const loaded =
    await require("../../financial/IXIFinancialProviderService").getDocument({
      financialDocumentId: clean(acquisitionId),
    });
  const document = loaded?.data?.record?.financialDocument;
  const acquisition = document?.assetAcquisition;
  if (
    !loaded?.ok ||
    document?.documentType !== "asset-acquisition" ||
    acquisition?.context?.primaryPassportId !== row.passportId ||
    acquisition?.trade?.tradeId !== row.tradeId ||
    acquisition?.trade?.dealId !== row.dealId ||
    !["incurred", "posted"].includes(document.financialState)
  )
    fail("A matching recorded trade acquisition is required.");
  if (
    resolveEntityPassport(row.entityId).entityPassportId !==
    acquisition.context.entityPassportId
  )
    fail("Acquisition Entity does not match.");
  return document;
}

async function confirmTradeAcquisition(input) {
  scope(input);
  const key = keyOf(input.entityId, input.dealId, input.tradeId);
  const row = readJsonFile(storePath, {})[key];
  if (!row?.passportId)
    fail("Create the trade machine before recording its acquisition.");
  const document = await loadVerifiedAcquisition(row, input.acquisitionId);
  let result;
  updateJsonFile(storePath, {}, (store) => {
    if (
      store[key].acquisitionId &&
      store[key].acquisitionId !== input.acquisitionId
    )
      fail("This trade already has an acquisition record.");
    result = {
      ...store[key],
      status: "acquired",
      inventoryStatus: "pending",
      acquisitionId: input.acquisitionId,
      acquiredAt: document.occurredAt,
    };
    store[key] = result;
    return store;
  });
  return { row: result };
}

module.exports = {
  listTradeMachines,
  reserveTradeMachine,
  completeTradeMachine,
  confirmTradeAcquisition,
  verifiedOrderTrades,
  rejectTradeListingCreate,
  loadVerifiedAcquisition,
};
