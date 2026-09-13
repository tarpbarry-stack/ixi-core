"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { MosSqliteStore } = require("../mos/storage/sqliteStore");
test("recovery set restores SQLite and matching Passports independently of the original runtime", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-recovery-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "app"), dataRoot = path.join(root, "data");
  fs.mkdirSync(path.join(app, "passport"), { recursive: true });
  fs.writeFileSync(path.join(app, "passport/passports.json"), JSON.stringify([{ passportId: "IXI_RECOVER" }]));
  const files = { dataRoot, databasePath: path.join(dataRoot, "ixi-aos.sqlite") };
  const store = new MosSqliteStore(files);
  store.write(path.join(dataRoot, "objects.json"), {
    object_recover: { objectId: "object_recover", status: "active",
      identities: [{ identityType: "ixi-passport", passportId: "IXI_RECOVER" }] }
  });
  store.close();
  const output = path.join(root, "recovery");
  const script = path.join(__dirname, "runtime-recovery.py");
  const capture = spawnSync("python3", [script, "create", "--app-root", app,
    "--mos-db", files.databasePath, "--output-dir", output, "--writers-stopped"], { encoding: "utf8" });
  assert.equal(capture.status, 0, capture.stderr);
  const report = JSON.parse(capture.stdout);
  assert.equal(report.census.activeObjects, 1);
  assert.equal(report.census.passports, 1);
  fs.rmSync(app, { recursive: true });
  fs.rmSync(dataRoot, { recursive: true });
  const check = () => spawnSync("python3", [script, "verify", "--output-dir", output], { encoding: "utf8" });
  assert.equal(check().status, 0);
  fs.appendFileSync(path.join(output, "runtime.tar.gz"), "corruption");
  const corrupt = check();
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /Recovery checksum failed/);
});

for (const scenario of [
  { name: "online recovery freezes the matching Passport snapshot before archive compression", online: true, phase: "archive", succeeds: true },
  { name: "a Passport write during the SQLite snapshot still rejects the recovery set", online: true, phase: "database", succeeds: false },
  { name: "quiesced recovery still rejects any Passport write during archive creation", online: false, phase: "archive", succeeds: false }
]) test(scenario.name, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-recovery-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "app"), dataRoot = path.join(root, "data"), output = path.join(root, "recovery");
  fs.mkdirSync(path.join(app, "passport"), { recursive: true });
  fs.writeFileSync(path.join(app, "passport/passports.json"), JSON.stringify([{ passportId: "IXI_RECOVER" }]));
  const databasePath = path.join(dataRoot, "ixi-aos.sqlite");
  const store = new MosSqliteStore({ dataRoot, databasePath });
  store.write(path.join(dataRoot, "objects.json"), { object_recover: { objectId: "object_recover", status: "active", identities: [{ identityType: "ixi-passport", passportId: "IXI_RECOVER" }] } });
  store.close();
  const program = `
import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('recovery',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
app=pathlib.Path(sys.argv[2]); registry=app/'passport/passports.json'
def change(): registry.write_text(json.dumps([{'passportId':'IXI_RECOVER'},{'passportId':'IXI_ADDED_LATER'}]))
if sys.argv[5]=='archive':
    original_add=module.tarfile.TarFile.add
    changed=[False]
    def add(self,*args,**kwargs):
        if not changed[0]: changed[0]=True; change()
        return original_add(self,*args,**kwargs)
    module.tarfile.TarFile.add=add
else:
    original_connect=module.sqlite3.connect
    class Writer(module.sqlite3.Connection):
        def backup(self,*args,**kwargs):
            result=super().backup(*args,**kwargs);change();return result
    module.sqlite3.connect=lambda *args,**kwargs: original_connect(*args,factory=Writer,**kwargs)
result=module.create(str(app),sys.argv[3],sys.argv[4],sys.argv[6]=='true')
print(json.dumps(result))
`;
  const result = spawnSync("python3", ["-c", program, path.join(__dirname, "runtime-recovery.py"), app, databasePath, output, scenario.phase, String(scenario.online)], { encoding: "utf8" });
  if (scenario.succeeds) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).census.passports, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(app, "passport/passports.json"), "utf8")).length, 2);
    const verify = spawnSync("python3", [path.join(__dirname, "runtime-recovery.py"), "verify", "--output-dir", output], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).census.passports, 1);
  } else {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Passport registry changed during capture/);
    assert.equal(fs.existsSync(path.join(output, "recovery.json")), false);
  }
});
