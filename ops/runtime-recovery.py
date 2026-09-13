#!/usr/bin/env python3
"""Capture and verify IX-Core data with a SQLite snapshot and stable Passports."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
from datetime import datetime, timezone

def digest(file):
    h = hashlib.sha256()
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def census(database_file, passports):
    db = sqlite3.connect(f"file:{Path(database_file).resolve()}?mode=ro", uri=True)
    try:
        integrity = db.execute("PRAGMA quick_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError("SQLite integrity verification failed")
        rows = db.execute("SELECT collection_key,payload,payload_sha256 FROM mos_collections").fetchall()
        values = {}
        for key, payload, expected in rows:
            if hashlib.sha256(payload.encode()).hexdigest() != expected:
                raise ValueError("Collection checksum failed: " + key)
            values[key] = json.loads(payload)
    finally:
        db.close()
    if not isinstance(passports, list):
        raise ValueError("Passport registry must be an array")
    passport_ids = [record["passportId"] for record in passports]
    if len(passport_ids) != len(set(passport_ids)):
        raise ValueError("Duplicate Passport IDs in recovery set")
    aliases = {}
    for record in passports:
        for alias in [record["passportId"], *(record.get("previousPassportIds") or [])]:
            if alias in aliases and aliases[alias] != record["passportId"]:
                raise ValueError("Conflicting Passport aliases")
            aliases[alias] = record["passportId"]
    objects = values.get("objects.json", {})
    records = list(objects.values()) if isinstance(objects, dict) else objects
    active = [record for record in records if record.get("status") == "active"]
    identities = {}
    for record in active:
        refs = {aliases.get(identity.get("passportId"), identity.get("passportId"))
                for identity in record.get("identities", [])
                if identity.get("identityType") == "ixi-passport" and identity.get("passportId")}
        if len(refs) != 1 or not refs.issubset(set(passport_ids)):
            raise ValueError("Active Object lacks one recoverable Passport: " + record["objectId"])
        passport = next(iter(refs))
        if passport in identities and identities[passport] != record["objectId"]:
            raise ValueError("Active Objects share a Passport")
        identities[passport] = record["objectId"]
    return {
        "integrity": integrity, "collections": len(rows),
        "objects": len(records), "activeObjects": len(active), "passports": len(passports),
        "activeIdentitySha256": hashlib.sha256(json.dumps(identities, sort_keys=True).encode()).hexdigest(),
        "collectionChecksums": {key: sha for key, _, sha in rows}
    }

def create(app_root, mos_database, output_dir, online=False):
    app = Path(app_root).resolve()
    output = Path(output_dir).resolve()
    if app == output or app in output.parents:
        raise ValueError("Recovery output must be outside the runtime")
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    passport_file = app / "passport/passports.json"
    passport_stat = passport_file.stat()
    passport_bytes = passport_file.read_bytes()
    passport_before = hashlib.sha256(passport_bytes).hexdigest()
    database = output / "aos.sqlite"
    source = sqlite3.connect(f"file:{Path(mos_database).resolve()}?mode=ro", uri=True)
    target = sqlite3.connect(database)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    os.chmod(database, 0o600)
    # The cross-store boundary is the SQLite snapshot, not the time needed to
    # compress the rest of the runtime. Freeze these exact Passport bytes and
    # require them to remain stable throughout that database snapshot.
    if digest(passport_file) != passport_before:
        raise ValueError("Passport registry changed during capture; retry the recovery set")
    passports = json.loads(passport_bytes)
    proof = census(database, passports)
    archive_file = output / "runtime.tar.gz"
    with tarfile.open(archive_file, "w:gz") as archive:
        def include(member):
            relative = Path(member.name)
            if relative == Path("runtime/passport/passports.json"):
                return None
            if any(part in {"node_modules", ".git", "backups"} for part in relative.parts):
                return None
            # Socket and device state is neither application code nor business data.
            if member.isdev() or member.isfifo():
                return None
            return member
        archive.add(app, arcname="runtime", filter=include)
        passport_member = tarfile.TarInfo("runtime/passport/passports.json")
        passport_member.size = len(passport_bytes)
        passport_member.mode = passport_stat.st_mode & 0o777
        passport_member.uid = passport_stat.st_uid
        passport_member.gid = passport_stat.st_gid
        passport_member.mtime = passport_stat.st_mtime
        archive.addfile(passport_member, io.BytesIO(passport_bytes))
    os.chmod(archive_file, 0o600)
    if not online and digest(passport_file) != passport_before:
        raise ValueError("Passport registry changed during capture; retry the recovery set")
    manifest = {
        "schema": "ixi.recovery.v1", "createdAt": datetime.now(timezone.utc).isoformat(),
        "consistency": "sqlite-snapshot-stable-passports" if online else "quiesced-runtime",
        "sourceApp": str(app), "sourceDatabase": str(Path(mos_database).resolve()),
        "census": proof,
        "files": {name: {"sha256": digest(output / name), "bytes": (output / name).stat().st_size}
                  for name in ["aos.sqlite", "runtime.tar.gz"]}
    }
    (output / "recovery.json").write_text(json.dumps(manifest, indent=2) + "\n")
    os.chmod(output / "recovery.json", 0o600)
    verify(output)
    return manifest

def verify(output_dir):
    root = Path(output_dir).resolve()
    manifest = json.loads((root / "recovery.json").read_text())
    if manifest.get("schema") != "ixi.recovery.v1":
        raise ValueError("Unknown recovery format")
    for name in ["aos.sqlite", "runtime.tar.gz"]:
        expected = manifest["files"][name]
        if digest(root / name) != expected["sha256"]:
            raise ValueError("Recovery checksum failed: " + name)
    with tarfile.open(root / "runtime.tar.gz", "r:gz") as archive:
        for member in archive.getmembers():
            relative = Path(member.name)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Unsafe recovery archive path")
            if member.issym() or member.islnk():
                target = Path(member.linkname)
                if target.is_absolute() or ".." in target.parts:
                    raise ValueError("Recovery archive requires manual review of an external symlink")
        with tempfile.TemporaryDirectory(prefix="ixi-restore-verify-") as restored:
            archive.extractall(restored, filter="data")
            restored_root = Path(restored) / "runtime"
            passport_bytes = (restored_root / "passport/passports.json").read_bytes()
            for record_file in restored_root.rglob("*.json"):
                json.loads(record_file.read_text())
            for database in restored_root.rglob("*.sqlite"):
                connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
                try:
                    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise ValueError("Restored runtime SQLite failed integrity: " + str(database.relative_to(restored_root)))
                finally:
                    connection.close()
    proof = census(root / "aos.sqlite", json.loads(passport_bytes))
    if proof != manifest["census"]:
        raise ValueError("Restored census differs from recovery manifest")
    return {"ok": True, "createdAt": manifest["createdAt"], "census": proof}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    capture = sub.add_parser("create")
    capture.add_argument("--app-root", required=True)
    capture.add_argument("--mos-db", required=True)
    capture.add_argument("--output-dir", required=True)
    mode = capture.add_mutually_exclusive_group(required=True)
    mode.add_argument("--writers-stopped", action="store_true",
                         help="Caller must stop IX-Core, IXI-Media-Worker and the integrity worker before capture.")
    mode.add_argument("--online", action="store_true", help="Reject capture if Passport identity changes during the SQLite snapshot.")
    check = sub.add_parser("verify")
    check.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    result = create(args.app_root, args.mos_db, args.output_dir, args.online) if args.action == "create" else verify(args.output_dir)
    print(json.dumps(result, indent=2))
if __name__ == "__main__":
    main()
