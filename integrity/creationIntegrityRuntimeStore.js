"use strict";

const fs = require("fs");
const path = require("path");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(filePath);
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

function createFileRuntimeStore({
  stateFile,
  alertFile
} = {}) {
  if (!stateFile) throw new Error("Creation integrity runtime store requires stateFile.");
  if (!alertFile) throw new Error("Creation integrity runtime store requires alertFile.");

  function loadState({ entityId }) {
    const store = readJson(stateFile, {});
    return store[String(entityId || "").trim()] || null;
  }

  function saveState({ entityId, state }) {
    const key = String(entityId || "").trim();
    if (!key) throw new Error("Creation integrity state requires entityId.");
    const store = readJson(stateFile, {});
    store[key] = state;
    writeJsonAtomic(stateFile, store);
    return state;
  }

  function emitAlert(alert) {
    ensureDirectory(alertFile);
    fs.appendFileSync(alertFile, `${JSON.stringify(alert)}\n`, "utf8");
    return { accepted: true };
  }

  return {
    loadState,
    saveState,
    emitAlert,
    paths: {
      stateFile,
      alertFile
    }
  };
}

module.exports = {
  readJson,
  writeJsonAtomic,
  createFileRuntimeStore
};