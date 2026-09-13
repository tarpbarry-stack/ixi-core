"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const protectedPaths = /^(?:data\/|\.env(?:\.|$)|passport\/passports\.json$|ixi-machine-state\.json$|acquisition\/(?:capture\/artifacts|audit|identity\/Queue)\/)/;
function safeRelative(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) ||
      value.split(/[\\/]/).some(part => part === ".." || part === "")) {
    throw new Error("Invalid release path");
  }
  if (protectedPaths.test(value)) throw new Error("Release cannot overwrite runtime data: " + value);
  return value;
}
function checksum(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function createManifest(root, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("An immutable commit SHA is required");
  const entries = execFileSync("git", ["ls-tree", "-rz", "--full-tree", commit], {
    cwd: root, encoding: "utf8"
  }).split("\0").filter(Boolean);
  const files = {};
  for (const entry of entries) {
    const [metadata, relative] = entry.split("\t");
    const [mode, type, blob] = metadata.split(" ");
    if (type !== "blob" || !/\.(?:js|mjs|cjs|json|sh|py|service|timer)$/.test(relative) || relative.startsWith(".github/")) continue;
    safeRelative(relative);
    if (!["100644", "100755"].includes(mode)) throw new Error("Release source must be a regular file: " + relative);
    const actual = execFileSync("git", ["hash-object", "--", relative], { cwd: root, encoding: "utf8" }).trim();
    if (actual !== blob) throw new Error("Working source differs from the release commit: " + relative);
    files[relative] = { sha256: checksum(path.join(root, relative)), mode };
  }
  for (const required of ["index.js", "package.json", "package-lock.json",
    "mos/storage/sqliteStore.js", "passport/passportRegistry.js"]) {
    if (!files[required]) throw new Error("Incomplete runtime source: " + required);
  }
  return { schema: "ixi.runtime-release.v1", commit, files };
}
function verifyManifest(root, manifest) {
  if (manifest.schema !== "ixi.runtime-release.v1" || !/^[a-f0-9]{40}$/.test(manifest.commit) ||
      !manifest.files || !Object.keys(manifest.files).length) throw new Error("Invalid release manifest");
  const failures = [];
  for (const [relative, expected] of Object.entries(manifest.files)) {
    safeRelative(relative);
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) failures.push({ path: relative, reason: "missing" });
    else if (!fs.lstatSync(file).isFile()) failures.push({ path: relative, reason: "not-regular-file" });
    else if (checksum(file) !== expected.sha256) failures.push({ path: relative, reason: "checksum" });
  }
  return { ok: failures.length === 0, commit: manifest.commit, checkedFiles: Object.keys(manifest.files).length, failures };
}
if (require.main === module) {
  try {
    const [action, root, value] = process.argv.slice(2);
    if (action === "create") process.stdout.write(JSON.stringify(createManifest(path.resolve(root), value), null, 2) + "\n");
    else if (action === "verify") {
      const result = verifyManifest(path.resolve(root), JSON.parse(fs.readFileSync(value, "utf8")));
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      if (!result.ok) process.exitCode = 1;
    } else throw new Error("Usage: runtime-release.js create ROOT COMMIT | verify ROOT MANIFEST");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
module.exports = { createManifest, verifyManifest, safeRelative };
