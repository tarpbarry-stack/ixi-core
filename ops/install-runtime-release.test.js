"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
test("complete source install and rollback preserve business data and remove only newly installed source", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-install-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "app"), stage = path.join(root, "stage"), backup = path.join(root, "rollback");
  fs.mkdirSync(path.join(app, "passport"), { recursive: true });
  fs.mkdirSync(stage);
  fs.writeFileSync(path.join(app, "index.js"), "old source");
  fs.writeFileSync(path.join(app, "passport/passports.json"), "permanent identity");
  const files = {};
  for (const [file, value] of [["index.js", "complete source"], ["new.js", "new module"], ["new/nested/module.js", "nested source"]]) {
    fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
    fs.writeFileSync(path.join(stage, file), value);
    files[file] = { sha256: crypto.createHash("sha256").update(value).digest("hex"), mode: "100644" };
  }
  const manifest = path.join(root, "release.json");
  fs.writeFileSync(manifest, JSON.stringify({ schema: "ixi.runtime-release.v1", commit: "a".repeat(40), files }));
  const script = path.join(__dirname, "install-runtime-release.py");
  const priorMask = process.umask(0o077);
  let result;
  try {
    result = spawnSync("python3", [script, "install", "--stage", stage, "--app", app,
      "--manifest", manifest, "--backup", backup], { encoding: "utf8" });
  } finally {
    process.umask(priorMask);
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(app, "index.js"), "utf8"), "complete source");
  for (const relative of ["new", "new/nested"]) {
    assert.equal(fs.statSync(path.join(app, relative)).mode & 0o777, 0o755);
  }
  assert.equal(fs.statSync(path.join(app, "new/nested/module.js")).mode & 0o777, 0o644);
  const reverted = spawnSync("python3", [script, "rollback", "--app", app, "--backup", backup], { encoding: "utf8" });
  assert.equal(reverted.status, 0, reverted.stderr);
  assert.equal(fs.readFileSync(path.join(app, "index.js"), "utf8"), "old source");
  assert.equal(fs.existsSync(path.join(app, "new.js")), false);
  assert.equal(fs.existsSync(path.join(app, ".ixi-release.json")), false);
  assert.equal(fs.readFileSync(path.join(app, "passport/passports.json"), "utf8"), "permanent identity");
});
