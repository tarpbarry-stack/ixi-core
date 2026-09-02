const fs = require("fs");
const path = require("path");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath, fallback) {
  ensureParentDirectory(filePath);

  if (!fs.existsSync(filePath)) {
    writeJsonFileAtomic(filePath, fallback);
    return clone(fallback);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("MOS JSON READ FAILED:", {
      filePath,
      error: error?.message || String(error)
    });

    throw error;
  }
}

function writeJsonFileAtomic(filePath, value) {
  ensureParentDirectory(filePath);

  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryPath, filePath);

  return value;
}

function updateJsonFile(filePath, fallback, updater) {
  const current = readJsonFile(filePath, fallback);
  const next = updater(clone(current));

  writeJsonFileAtomic(filePath, next);

  return next;
}

module.exports = {
  readJsonFile,
  writeJsonFileAtomic,
  updateJsonFile
};
