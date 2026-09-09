#!/usr/bin/env node
"use strict";

const {
  repairEquipmentMembership
} = require("../mos/migrations/equipmentMembershipRepairService");

function argument(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find(value => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : "";
}

const apply = process.argv.slice(2).includes("--apply");
const entityId = argument("entity");
const actorId = argument("actor");
const expectedMachineCount = Number(argument("expected-machines"));

try {
  const result = repairEquipmentMembership({
    entityId,
    actorId,
    expectedMachineCount,
    apply
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code || "AOS_EQUIPMENT_REPAIR_FAILED",
    message: error?.message || String(error),
    details: error?.details || null
  }, null, 2)}\n`);
  process.exitCode = 1;
}
