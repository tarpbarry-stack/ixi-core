const path = require("path");
const jsonFileStore = require("./jsonFileStore");

function configuredProvider() {
  const provider = String(process.env.IXI_MOS_STORAGE_PROVIDER || "json")
    .trim().toLowerCase();
  if (!["json", "sqlite"].includes(provider)) {
    const error = new Error(`Unsupported MOS storage provider: ${provider}`);
    error.code = "MOS_STORAGE_PROVIDER_UNSUPPORTED";
    throw error;
  }
  return provider;
}

function sqlite() {
  /* Load node:sqlite only when the database provider is explicitly selected. */
  const { getMosSqliteStore } = require("./sqliteStore");
  const dataRoot = process.env.IXI_MOS_DATA_ROOT || path.join(process.cwd(), "data", "mos");
  return getMosSqliteStore({ dataRoot });
}

function readJsonFile(filePath, fallback) {
  return configuredProvider() === "sqlite"
    ? sqlite().read(filePath, fallback)
    : jsonFileStore.readJsonFile(filePath, fallback);
}

function writeJsonFileAtomic(filePath, value) {
  return configuredProvider() === "sqlite"
    ? sqlite().write(filePath, value)
    : jsonFileStore.writeJsonFileAtomic(filePath, value);
}

function updateJsonFile(filePath, fallback, updater) {
  return configuredProvider() === "sqlite"
    ? sqlite().update(filePath, fallback, updater)
    : jsonFileStore.updateJsonFile(filePath, fallback, updater);
}

function describeMosStorage() {
  if (configuredProvider() === "sqlite") return sqlite().health();
  return {
    ok: true,
    provider: "json",
    durableDatabase: false,
    migrationRequired: true
  };
}

module.exports = {
  readJsonFile,
  writeJsonFileAtomic,
  updateJsonFile,
  describeMosStorage
};
