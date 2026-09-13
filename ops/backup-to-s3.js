#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { captureStableRecovery } = require("./recovery-capture");
const { S3Client, GetPublicAccessBlockCommand, GetBucketVersioningCommand,
  PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

function sha(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256"), stream = fs.createReadStream(file);
    stream.on("error", reject).on("data", data => hash.update(data))
      .on("end", () => resolve(hash.digest("hex")));
  });
}
async function main() {
  const app = path.resolve(process.env.IXI_LIVE_ROOT || "/var/www/ix-core");
  const database = process.env.IXI_MOS_SQLITE_PATH || "/var/lib/ixi-core/mos/ixi-aos.sqlite";
  const bucket = process.env.IXI_RECOVERY_BUCKET;
  const owner = process.env.IXI_RECOVERY_ACCOUNT_ID;
  if (!bucket || !/^\d{12}$/.test(owner || "")) throw new Error("Explicit private recovery bucket and account are required");
  const client = new S3Client({ region: process.env.AWS_REGION || "us-east-2" });
  const parameters = { Bucket: bucket, ExpectedBucketOwner: owner };
  const block = (await client.send(new GetPublicAccessBlockCommand(parameters))).PublicAccessBlockConfiguration;
  if (!block || !["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"].every(key => block[key] === true)) {
    throw new Error("Recovery bucket must block all public access");
  }
  if ((await client.send(new GetBucketVersioningCommand(parameters))).Status !== "Enabled") {
    throw new Error("Recovery bucket versioning must be enabled");
  }
  if (process.argv.includes("--preflight")) {
    process.stdout.write(JSON.stringify({ ok: true, bucket, private: true, versioned: true }) + "\n");
    return;
  }
  const parent = process.env.IXI_RECOVERY_LOCAL_ROOT || "/var/backups/ixi-core-releases";
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const working = fs.mkdtempSync(path.join(parent, "verified-recovery-"));
  let output;
  let retained = false;
  try {
    const result = captureStableRecovery(attempt => {
      output = path.join(working, `data-${attempt}`);
      const captured = spawnSync("python3", [path.join(__dirname, "runtime-recovery.py"), "create",
        "--app-root", app, "--mos-db", database, "--output-dir", output,
        process.argv.includes("--writers-stopped") ? "--writers-stopped" : "--online"
      ], { encoding: "utf8", timeout: 180000 });
      if (captured.status !== 0) fs.rmSync(output, { recursive: true, force: true });
      return captured;
    });
    const manifest = JSON.parse(result.stdout);
    const bundle = path.join(working, "recovery.tar.gz");
    const packed = spawnSync("tar", ["-czf", bundle, "-C", output, "."], { encoding: "utf8", timeout: 180000 });
    if (packed.status !== 0) throw new Error(packed.stderr || "Recovery packaging failed");
    const checksum = await sha(bundle);
    const key = "recovery/" + manifest.createdAt.replace(/[:.]/g, "-") + "-" + checksum.slice(0,12) + ".tar.gz";
    const put = await client.send(new PutObjectCommand({
      ...parameters, Key: key, Body: fs.createReadStream(bundle), ContentType: "application/gzip",
      ServerSideEncryption: "AES256", Metadata: { sha256: checksum }, IfNoneMatch: "*"
    }));
    if (!put.VersionId) throw new Error("Recovery upload has no immutable S3 version");
    const readback = await client.send(new GetObjectCommand({ ...parameters, Key: key, VersionId: put.VersionId }));
    const actual = crypto.createHash("sha256");
    for await (const chunk of readback.Body) actual.update(chunk);
    if (actual.digest("hex") !== checksum) throw new Error("Recovery download checksum mismatch");
    retained = process.argv.includes("--keep-local");
    const receipt = { ok: true, bucket, key, versionId: put.VersionId, sha256: checksum,
      createdAt: manifest.createdAt, consistency: manifest.consistency,
      census: manifest.census, localRecovery: retained ? output : null };
    const receiptPath = path.join(parent, "latest-recovery.json");
    fs.writeFileSync(receiptPath + ".tmp", JSON.stringify(receipt, null, 2), { mode: 0o600 });
    fs.renameSync(receiptPath + ".tmp", receiptPath);
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } finally {
    // Only this invocation's generated temporary set is removed, after failures
    // or after a verified off-server copy when the caller did not retain it.
    if (!retained) fs.rmSync(working, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
