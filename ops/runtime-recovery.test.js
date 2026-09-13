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
test("online recovery freezes matching Passports before packaging and rejects changes during the SQLite snapshot", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-online-recovery-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "app"), dataRoot = path.join(root, "data");
  fs.mkdirSync(path.join(app, "passport"), { recursive: true });
  fs.writeFileSync(path.join(app, "passport/passports.json"), JSON.stringify([{ passportId: "IXI_RECOVER", label: "original" }]));
  const databasePath = path.join(dataRoot, "ixi-aos.sqlite");
  const store = new MosSqliteStore({ dataRoot, databasePath });
  store.write(path.join(dataRoot, "objects.json"), { object_recover: { objectId: "object_recover", status: "active", identities: [{ identityType: "ixi-passport", passportId: "IXI_RECOVER" }] } });
  store.close();
  const script = `
import importlib.util,json,pathlib,sqlite3,sys,tarfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('recovery',sys.argv[1])
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
root=pathlib.Path(sys.argv[2]);app=root/'app';registry=app/'passport/passports.json'
original=registry.read_bytes();changed=original.replace(b'original',b'later')
add=tarfile.TarFile.add
def changing_add(archive,name,*args,**kwargs):
    if pathlib.Path(name)==app: registry.write_bytes(changed)
    return add(archive,name,*args,**kwargs)
with patch.object(tarfile.TarFile,'add',changing_add):
    report=r.create(app,sys.argv[3],root/'online',True)
assert r.verify(root/'online')['ok']
with tarfile.open(root/'online/runtime.tar.gz') as archive:
    assert archive.extractfile('runtime/passport/passports.json').read()==original
assert registry.read_bytes()==changed
registry.write_bytes(original)
connect=sqlite3.connect
class Source:
    def __init__(self,connection): self.connection=connection
    def backup(self,target):
        self.connection.backup(target)
        registry.write_bytes(changed)
    def close(self): self.connection.close()
def changing_connect(name,*args,**kwargs):
    connection=connect(name,*args,**kwargs)
    return Source(connection) if str(name).endswith('?mode=ro') else connection
with patch.object(sqlite3,'connect',changing_connect):
    try: r.create(app,sys.argv[3],root/'collision',True)
    except ValueError as error: assert 'Passport registry changed during capture' in str(error)
    else: raise AssertionError('Unstable snapshot was accepted')
print('verified stable packaged registry and rejected snapshot collision')
`;
  const result = spawnSync("python3", ["-c", script, path.join(__dirname, "runtime-recovery.py"), root, databasePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
