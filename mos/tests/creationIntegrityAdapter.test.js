'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ixi-integrity-adapter-'));
process.env.IXI_MOS_DATA_ROOT = root;
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, 'passports.json');
const { MOS_PATHS } = require('../storage/mosPaths');
const { writeJsonFileAtomic } = require('../storage/jsonStore');
const { writePassportRecords } = require('../../passport/passportRegistry');
const adapter = require('../integrity/liveCreationIntegrityAdapter');
const { reconcileCreationIntegrity } = require('../../integrity/creationIntegrityService');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('real adapter includes reused listing, retired and bound legacy identities, without tenant leakage or writes', () => {
  const object = (id, status, contract = true) => ({ objectId: id, entityId: 'ENT-1', status,
    identities: [{ identityType: 'ixi-passport', passportId: 'PASS-' + id }],
    metadata: contract ? { provisioning: { contractVersion: adapter.PROVISIONING_CONTRACT } } : {} });
  const objects = [object('listing', 'active'), object('retired', 'soft-deleted'),
    object('legacy', 'active', false), object('unbound-legacy', 'active', false),
    { ...object('other', 'active'), entityId: 'ENT-2' }];
  writeJsonFileAtomic(MOS_PATHS.objects, Object.fromEntries(objects.map(x => [x.objectId, x])));
  writePassportRecords(objects.filter(x => x.objectId !== 'unbound-legacy').map(x => ({
    passportId: 'PASS-' + x.objectId, entityId: x.entityId,
    sourceType: x.objectId === 'listing' ? 'sharetribe-listing' : 'aos-object', sourceId: x.objectId,
    sources: [{ sourceType: 'aos-object', sourceId: x.objectId }]
  })));
  const paths = [MOS_PATHS.objects, process.env.IXI_PASSPORT_DATA_FILE];
  const before = paths.map(p => [fs.readFileSync(p, 'utf8'), fs.statSync(p).ino]);
  const scoped = adapter.loadObjects({ entityId: 'ENT-1' });
  assert.deepEqual(scoped.map(x => x.objectId).sort(), ['legacy', 'listing', 'retired']);
  const passports = adapter.loadPassports({ entityId: 'ENT-1' });
  assert.equal(passports.length, 3);
  assert.equal(reconcileCreationIntegrity({ entityId: 'ENT-1', objects: scoped, passports }).status, 'healthy');
  assert.deepEqual(adapter.listIntegrityEntityIds(), ['ENT-1', 'ENT-2']);
  assert.deepEqual(paths.map(p => [fs.readFileSync(p, 'utf8'), fs.statSync(p).ino]), before);
});

test('wrong-tenant Passport referenced by our Object remains visible as a defect', () => {
  const objects = [{ objectId: 'OBJ', entityId: 'ENT-1', identities: [{ identityType: 'ixi-passport', passportId: 'PASS' }],
    metadata: { provisioning: { contractVersion: adapter.PROVISIONING_CONTRACT } } }];
  const passports = [{ passportId: 'PASS', entityId: 'ENT-2', sourceType: 'sharetribe-listing', sourceId: 'listing',
    sources: [{ sourceType: 'aos-object', sourceId: 'OBJ' }] }];
  const selected = adapter.selectPassports('ENT-1', objects, passports);
  assert.equal(selected.length, 1);
  assert.ok(reconcileCreationIntegrity({ entityId: 'ENT-1', objects, passports: selected }).findings.some(x => x.code === 'PASSPORT_ENTITY_ID_MISMATCH'));
});
