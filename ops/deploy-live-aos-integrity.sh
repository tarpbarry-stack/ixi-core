#!/usr/bin/env bash
set -euo pipefail

# IXI AOS creation-integrity production overlay installer.
#
# This repository intentionally does not yet contain the full live MOS tree.
# This script applies the source-controlled overlay to an existing canonical
# /var/www/ix-core deployment without inventing or replacing unrelated MOS code.
#
# Usage:
#   SOURCE_ROOT=/path/to/ixi-core TARGET_ROOT=/var/www/ix-core \
#     bash ops/deploy-live-aos-integrity.sh

SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TARGET_ROOT="${TARGET_ROOT:-/var/www/ix-core}"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERROR: required file not found: $1" >&2
    exit 1
  fi
}

backup_once() {
  local source="$1"
  local backup="$2"
  if [[ ! -e "$backup" ]]; then
    cp "$source" "$backup"
  fi
}

require_file "$TARGET_ROOT/passport/passportRegistry.js"
require_file "$TARGET_ROOT/mos/provisioning/aosObjectProvisioningService.js"
require_file "$TARGET_ROOT/mos/routes/mosRouter.js"
require_file "$TARGET_ROOT/mos/security/internalRequestAuthService.js"
require_file "$TARGET_ROOT/mos/security/internalTenantBoundaryService.js"
require_file "$TARGET_ROOT/.env"

for file in \
  integrity/creationIntegrityService.js \
  integrity/creationIntegrityRouter.js \
  integrity/creationIntegrityRunner.js \
  integrity/creationIntegrityRuntimeStore.js \
  integrity/creationIntegrityWorker.js \
  live/mos/integrity/liveCreationIntegrityAdapter.js \
  live/mos/integrity/liveCreationIntegrityWorkerAdapter.js \
  live/mos/provisioning/aosObjectPassportService.js \
  ops/systemd/ixi-aos-creation-integrity.service \
  ops/systemd/ixi-aos-creation-integrity.timer
  do
  require_file "$SOURCE_ROOT/$file"
done

mkdir -p \
  "$TARGET_ROOT/integrity" \
  "$TARGET_ROOT/mos/integrity"

backup_once \
  "$TARGET_ROOT/passport/passportRegistry.js" \
  "$TARGET_ROOT/passport/passportRegistry.js.before-aos-integrity-overlay"

backup_once \
  "$TARGET_ROOT/mos/provisioning/aosObjectProvisioningService.js" \
  "$TARGET_ROOT/mos/provisioning/aosObjectProvisioningService.js.before-aos-integrity-overlay"

backup_once \
  "$TARGET_ROOT/mos/provisioning/aosObjectPassportService.js" \
  "$TARGET_ROOT/mos/provisioning/aosObjectPassportService.js.before-aos-integrity-overlay"

backup_once \
  "$TARGET_ROOT/mos/routes/mosRouter.js" \
  "$TARGET_ROOT/mos/routes/mosRouter.js.before-aos-integrity-overlay"

install -m 0644 "$SOURCE_ROOT/integrity/creationIntegrityService.js" \
  "$TARGET_ROOT/integrity/creationIntegrityService.js"
install -m 0644 "$SOURCE_ROOT/integrity/creationIntegrityRouter.js" \
  "$TARGET_ROOT/integrity/creationIntegrityRouter.js"
install -m 0644 "$SOURCE_ROOT/integrity/creationIntegrityRunner.js" \
  "$TARGET_ROOT/integrity/creationIntegrityRunner.js"
install -m 0644 "$SOURCE_ROOT/integrity/creationIntegrityRuntimeStore.js" \
  "$TARGET_ROOT/integrity/creationIntegrityRuntimeStore.js"
install -m 0644 "$SOURCE_ROOT/integrity/creationIntegrityWorker.js" \
  "$TARGET_ROOT/integrity/creationIntegrityWorker.js"

install -m 0644 "$SOURCE_ROOT/live/mos/integrity/liveCreationIntegrityAdapter.js" \
  "$TARGET_ROOT/mos/integrity/liveCreationIntegrityAdapter.js"
install -m 0644 "$SOURCE_ROOT/live/mos/integrity/liveCreationIntegrityWorkerAdapter.js" \
  "$TARGET_ROOT/mos/integrity/liveCreationIntegrityWorkerAdapter.js"
install -m 0644 "$SOURCE_ROOT/live/mos/provisioning/aosObjectPassportService.js" \
  "$TARGET_ROOT/mos/provisioning/aosObjectPassportService.js"

TARGET_ROOT="$TARGET_ROOT" python3 <<'PY'
from pathlib import Path
import os

root = Path(os.environ["TARGET_ROOT"])

# ------------------------------------------------------------------
# Passport registry: persist entityId on NEW records when supplied.
# Existing records are not rewritten.
# ------------------------------------------------------------------
path = root / "passport/passportRegistry.js"
text = path.read_text()

if "const entityId = String(input.entityId || \"\").trim();" not in text:
    old = '''function createPassportRecord(input = {}) {
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();
'''
    new = '''function createPassportRecord(input = {}) {
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();
  const entityId = String(input.entityId || "").trim();
'''
    if old not in text:
        raise SystemExit("passportRegistry createPassportRecord anchor not found")
    text = text.replace(old, new, 1)

if "entityId:\n      entityId || null" not in text:
    old = '''    sourceType,
    sourceId,

    visibility: input.visibility || "private",
'''
    new = '''    sourceType,
    sourceId,

    /* Trusted creation boundaries may persist tenant identity. */
    entityId:
      entityId || null,

    visibility: input.visibility || "private",
'''
    if old not in text:
        raise SystemExit("passportRegistry record anchor not found")
    text = text.replace(old, new, 1)

path.write_text(text)

# ------------------------------------------------------------------
# Provisioning: propagate authoritative Object tenant into Passport
# creation and verification.
# ------------------------------------------------------------------
path = root / "mos/provisioning/aosObjectProvisioningService.js"
text = path.read_text()

old = '''      ensurePassportForAosObject({
        objectId:
          object.objectId
      });'''
new = '''      ensurePassportForAosObject({
        objectId:
          object.objectId,

        entityId:
          object.entityId
      });'''
if old in text:
    text = text.replace(old, new, 1)
elif "ensurePassportForAosObject({\n        objectId:\n          object.objectId,\n\n        entityId:\n          object.entityId" not in text:
    raise SystemExit("provisioning ensure Passport anchor not found")

old = '''      verifyAosObjectPassport({
        objectId:
          object.objectId,

        passportId:
          passport.passportId
      });'''
new = '''      verifyAosObjectPassport({
        objectId:
          object.objectId,

        passportId:
          passport.passportId,

        entityId:
          object.entityId
      });'''
if old in text:
    text = text.replace(old, new, 1)
elif "verifyAosObjectPassport({\n        objectId:\n          object.objectId,\n\n        passportId:\n          passport.passportId,\n\n        entityId:\n          object.entityId" not in text:
    raise SystemExit("provisioning verify Passport anchor not found")

path.write_text(text)

# ------------------------------------------------------------------
# MOS router: mount read-only control plane INSIDE HMAC + tenant
# boundary. Never accept browser-selected entity identity.
# ------------------------------------------------------------------
path = root / "mos/routes/mosRouter.js"
text = path.read_text()

if "createCreationIntegrityRouter" not in text:
    anchor = '''const {
  createInternalTenantBoundaryMiddleware
} = require(
  "../security/internalTenantBoundaryService"
);
'''
    replacement = '''const {
  createInternalTenantBoundaryMiddleware
} = require(
  "../security/internalTenantBoundaryService"
);

const {
  createCreationIntegrityRouter
} = require(
  "../../integrity/creationIntegrityRouter"
);

const {
  loadObjects:
    loadCreationIntegrityObjects,
  loadPassports:
    loadCreationIntegrityPassports,
  loadProvisioningRecords:
    loadCreationIntegrityProvisioningRecords
} = require(
  "../integrity/liveCreationIntegrityAdapter"
);
'''
    if anchor not in text:
        raise SystemExit("MOS router tenant import anchor not found")
    text = text.replace(anchor, replacement, 1)

if '"/aos/creation-integrity"' not in text:
    anchor = '''router.use(
  createInternalTenantBoundaryMiddleware()
);
'''
    replacement = '''router.use(
  createInternalTenantBoundaryMiddleware()
);

/*
 * Read-only permanent-birth integrity control plane.
 * req.ixiRequestContext exists only after HMAC + tenant enforcement.
 */
router.use(
  "/aos/creation-integrity",
  createCreationIntegrityRouter({
    resolveActor:
      async req => ({
        entityId:
          req.ixiRequestContext?.entityId,
        principalId:
          req.ixiRequestContext?.principalId
      }),
    loadObjects:
      loadCreationIntegrityObjects,
    loadPassports:
      loadCreationIntegrityPassports,
    loadProvisioningRecords:
      loadCreationIntegrityProvisioningRecords
  })
);
'''
    if anchor not in text:
        raise SystemExit("MOS router tenant middleware anchor not found")
    text = text.replace(anchor, replacement, 1)

path.write_text(text)
PY

# Environment entries: never write or reveal secrets here.
append_env_default() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "$TARGET_ROOT/.env"; then
    printf '%s=%s\n' "$key" "$value" >> "$TARGET_ROOT/.env"
  fi
}

append_env_default \
  IXI_AOS_CREATION_INTEGRITY_ADAPTER \
  ./mos/integrity/liveCreationIntegrityWorkerAdapter.js
append_env_default \
  IXI_AOS_CREATION_INTEGRITY_STATE_FILE \
  /var/www/ix-core/data/mos/creation-integrity-state.json
append_env_default \
  IXI_AOS_CREATION_INTEGRITY_ALERT_FILE \
  /var/www/ix-core/data/mos/creation-integrity-alerts.jsonl

if ! grep -q '^IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT=' "$TARGET_ROOT/.env"; then
  echo "ERROR: IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT must be explicitly configured." >&2
  exit 1
fi

# Syntax gates before touching process manager/systemd.
node -c "$TARGET_ROOT/passport/passportRegistry.js"
node -c "$TARGET_ROOT/mos/provisioning/aosObjectPassportService.js"
node -c "$TARGET_ROOT/mos/provisioning/aosObjectProvisioningService.js"
node -c "$TARGET_ROOT/mos/integrity/liveCreationIntegrityAdapter.js"
node -c "$TARGET_ROOT/mos/integrity/liveCreationIntegrityWorkerAdapter.js"
node -c "$TARGET_ROOT/integrity/creationIntegrityService.js"
node -c "$TARGET_ROOT/integrity/creationIntegrityRouter.js"
node -c "$TARGET_ROOT/integrity/creationIntegrityRunner.js"
node -c "$TARGET_ROOT/integrity/creationIntegrityRuntimeStore.js"
node -c "$TARGET_ROOT/integrity/creationIntegrityWorker.js"
node -c "$TARGET_ROOT/mos/routes/mosRouter.js"

if [[ "${INSTALL_SYSTEMD:-1}" == "1" ]]; then
  sudo install -m 0644 \
    "$SOURCE_ROOT/ops/systemd/ixi-aos-creation-integrity.service" \
    /etc/systemd/system/ixi-aos-creation-integrity.service
  sudo install -m 0644 \
    "$SOURCE_ROOT/ops/systemd/ixi-aos-creation-integrity.timer" \
    /etc/systemd/system/ixi-aos-creation-integrity.timer
  sudo systemctl daemon-reload
  sudo systemd-analyze verify \
    /etc/systemd/system/ixi-aos-creation-integrity.service \
    /etc/systemd/system/ixi-aos-creation-integrity.timer
fi

echo "IXI AOS CREATION INTEGRITY OVERLAY INSTALLED AND SYNTAX-VERIFIED"
