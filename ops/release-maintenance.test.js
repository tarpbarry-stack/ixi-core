'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('release maintenance verifies capacity, bounded retention and real shell exit recovery paths', () => {
  const result = spawnSync('python3', [path.join(__dirname, 'test_release_maintenance.py'), '-v'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
