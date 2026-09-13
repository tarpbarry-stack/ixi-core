#!/usr/bin/env python3
"""Install every manifest-listed source file; restore only those files on rollback."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import os
import tempfile

def safe(root, relative):
    parts = Path(relative)
    if parts.is_absolute() or ".." in parts.parts or not parts.parts:
        raise ValueError("Invalid release path")
    if parts.parts[0] == "data" or str(parts).startswith(".env") or str(parts) in {
        "passport/passports.json", "ixi-machine-state.json"}:
        raise ValueError("Release cannot overwrite business data")
    if parts.suffix == ".json" and str(parts).startswith((
        "acquisition/capture/artifacts/", "acquisition/audit/", "acquisition/identity/Queue/")):
        raise ValueError("Release cannot overwrite acquisition runtime data")
    result = root / parts
    if root not in result.resolve().parents:
        raise ValueError("Release path escapes runtime")
    return result

def atomic_copy(source, target, mode=None):
    missing = []
    directory = target.parent
    while not directory.exists():
        missing.append(directory)
        directory = directory.parent
    for directory in reversed(missing):
        directory.mkdir()
        # Deployment runs with umask 077; source must remain traversable by the
        # unprivileged runtime. Existing data-directory permissions are retained.
        directory.chmod(0o755)
    descriptor, temporary = tempfile.mkstemp(prefix=".ixi-install-", dir=target.parent)
    os.close(descriptor)
    try:
        shutil.copy2(source, temporary)
        if mode is not None:
            os.chmod(temporary, mode)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def install(stage, app, manifest_file, backup):
    manifest = json.loads(manifest_file.read_text())
    if manifest.get("schema") != "ixi.runtime-release.v1":
        raise ValueError("Invalid release manifest")
    backup.mkdir(parents=True, exist_ok=False)
    before = {}
    for relative, expected in manifest["files"].items():
        source, target = safe(stage, relative), safe(app, relative)
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected["sha256"]:
            raise ValueError("Candidate differs from manifest: " + relative)
        before[relative] = target.exists()
        if target.exists():
            atomic_copy(target, safe(backup, relative))
    marker = app / ".ixi-release.json"
    before[".ixi-release.json"] = marker.exists()
    if marker.exists():
        atomic_copy(marker, backup / ".ixi-release.json")
    (backup / "rollback.json").write_text(json.dumps(before, indent=2))
    for relative, expected in manifest["files"].items():
        atomic_copy(safe(stage, relative), safe(app, relative),
                    0o755 if expected["mode"] == "100755" else 0o644)
    atomic_copy(manifest_file, marker, 0o644)

def rollback(app, backup):
    before = json.loads((backup / "rollback.json").read_text())
    for relative, existed in before.items():
        target = safe(app, relative)
        if existed:
            atomic_copy(safe(backup, relative), target)
        elif target.exists():
            target.unlink()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "rollback"])
    parser.add_argument("--app", required=True)
    parser.add_argument("--backup", required=True)
    parser.add_argument("--stage")
    parser.add_argument("--manifest")
    args = parser.parse_args()
    app, backup = Path(args.app).resolve(), Path(args.backup).resolve()
    if app == backup or app in backup.parents:
        raise ValueError("Source rollback backup must be outside the runtime")
    if args.action == "install":
        install(Path(args.stage).resolve(), app, Path(args.manifest).resolve(), backup)
    else:
        rollback(app, backup)
    print(json.dumps({"ok": True, "action": args.action}))
if __name__ == "__main__":
    main()
