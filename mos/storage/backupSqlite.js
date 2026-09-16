#!/usr/bin/env node
'use strict';
// Local diagnostic export only. Scheduled production recovery uses the complete
// private, versioned runtime recovery helper and its shared deployment lock.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function checksum(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const sourcePath = path.resolve(String(process.env.IXI_MOS_SQLITE_PATH || '').trim());
  if (!process.env.IXI_MOS_SQLITE_PATH || !fs.existsSync(sourcePath)) {
    throw new Error('IXI_MOS_SQLITE_PATH must identify an existing database.');
  }
  if (process.env.IXI_MOS_BACKUP_S3_BUCKET) {
    throw new Error('Remote recovery must use ops/backup-to-s3.js with the verified private recovery configuration.');
  }
  const backupRoot = path.resolve(process.env.IXI_MOS_BACKUP_ROOT || path.join(path.dirname(sourcePath), 'backups'));
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const destinationPath = path.join(backupRoot, 'latest-verified.sqlite');
  const receiptPath = path.join(backupRoot, 'latest-verified.json');
  if (fs.existsSync(destinationPath) && (fs.realpathSync(destinationPath) === fs.realpathSync(sourcePath) ||
      fs.lstatSync(destinationPath).isSymbolicLink())) throw new Error('Diagnostic export cannot replace its source or follow a redirected target');
  const stat = fs.statfsSync(backupRoot);
  const required = fs.statSync(sourcePath).size + 64 * 1024 * 1024;
  if (stat.bavail * stat.bsize < required || stat.ffree < 100) throw new Error('Insufficient capacity for a verified local SQLite export');
  const lockPath = path.join(backupRoot, '.snapshot.lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  let working;
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, sourcePath }));
    if (fs.existsSync(destinationPath)) {
      if (!fs.existsSync(receiptPath) || fs.lstatSync(receiptPath).isSymbolicLink() ||
          JSON.parse(fs.readFileSync(receiptPath, 'utf8')).checksum !== await checksum(destinationPath)) {
        throw new Error('Existing local export does not match its receipt; preserve it for review');
      }
    }
    working = fs.mkdtempSync(path.join(backupRoot, '.snapshot-'));
    const candidate = path.join(working, 'snapshot.sqlite');
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
      if (source.prepare('PRAGMA quick_check;').get()?.quick_check !== 'ok') throw new Error('Source database integrity failed');
      await source.backup(candidate);
    } finally { source.close(); }
    fs.chmodSync(candidate, 0o600);
    const copy = new Database(candidate, { readonly: true, fileMustExist: true });
    let integrity;
    try { integrity = copy.prepare('PRAGMA quick_check;').get()?.quick_check; }
    finally { copy.close(); }
    if (integrity !== 'ok') throw new Error('Backup database integrity failed');
    const report = { ok: true, sourcePath, destinationPath, checksum: await checksum(candidate), integrity,
      bytes: fs.statSync(candidate).size, createdAt: new Date().toISOString(), s3: null, retainedLocalSnapshots: 1 };
    const candidateReceipt = path.join(working, 'receipt.json');
    fs.writeFileSync(candidateReceipt, JSON.stringify(report, null, 2), { mode: 0o600 });
    for (const file of [candidate, candidateReceipt]) {
      const fd = fs.openSync(file, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    fs.renameSync(candidate, destinationPath);
    fs.renameSync(candidateReceipt, receiptPath);
    const directory = fs.openSync(backupRoot, 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally {
    if (working) fs.rmSync(working, { recursive: true, force: true });
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: error?.code || 'MOS_BACKUP_FAILED', error: error.message }) + '\n');
  process.exitCode = 1;
});
