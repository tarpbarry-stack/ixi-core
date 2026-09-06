#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

function timestampId() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function checksum(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main() {
  const sourcePath = path.resolve(String(process.env.IXI_MOS_SQLITE_PATH || "").trim());
  if (!process.env.IXI_MOS_SQLITE_PATH || !fs.existsSync(sourcePath)) {
    throw new Error("IXI_MOS_SQLITE_PATH must identify an existing database.");
  }

  const backupRoot = path.resolve(
    process.env.IXI_MOS_BACKUP_ROOT || path.join(path.dirname(sourcePath), "backups")
  );
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const destinationPath = path.join(backupRoot, `ixi-aos-${timestampId()}.sqlite`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });

  try {
    const sourceIntegrity = source.prepare("PRAGMA quick_check;").get()?.quick_check;
    if (sourceIntegrity !== "ok") {
      throw new Error(`Source database integrity failed: ${sourceIntegrity || "unknown"}`);
    }
    await source.backup(destinationPath);
  } finally {
    source.close();
  }

  fs.chmodSync(destinationPath, 0o600);
  const copy = new Database(destinationPath, { readonly: true, fileMustExist: true });
  const backupIntegrity = copy.prepare("PRAGMA quick_check;").get()?.quick_check;
  copy.close();
  if (backupIntegrity !== "ok") {
    throw new Error(`Backup database integrity failed: ${backupIntegrity || "unknown"}`);
  }

  const digest = checksum(destinationPath);
  const bucket = String(process.env.IXI_MOS_BACKUP_S3_BUCKET || "").trim();
  let s3 = null;

  if (bucket) {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-2";
    const prefix = String(process.env.IXI_MOS_BACKUP_S3_PREFIX || "aos-storage").replace(/^\/+|\/+$/g, "");
    const key = `${prefix}/${path.basename(destinationPath)}`;
    const client = new S3Client({ region });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(destinationPath),
      ContentType: "application/vnd.sqlite3",
      Metadata: { sha256: digest }
    }));
    s3 = { bucket, key, region };
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    sourcePath,
    destinationPath,
    checksum: digest,
    integrity: backupIntegrity,
    bytes: fs.statSync(destinationPath).size,
    s3
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code || "MOS_BACKUP_FAILED",
    error: error?.message || String(error)
  }, null, 2)}\n`);
  process.exitCode = 1;
});
