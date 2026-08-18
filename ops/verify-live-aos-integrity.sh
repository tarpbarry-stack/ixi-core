#!/usr/bin/env bash
set -euo pipefail

TARGET_ROOT="${TARGET_ROOT:-/var/www/ix-core}"

cd "$TARGET_ROOT"

for file in \
  passport/passportRegistry.js \
  mos/provisioning/aosObjectPassportService.js \
  mos/provisioning/aosObjectProvisioningService.js \
  mos/integrity/liveCreationIntegrityAdapter.js \
  mos/integrity/liveCreationIntegrityWorkerAdapter.js \
  integrity/creationIntegrityService.js \
  integrity/creationIntegrityRouter.js \
  integrity/creationIntegrityRunner.js \
  integrity/creationIntegrityRuntimeStore.js \
  integrity/creationIntegrityWorker.js \
  mos/routes/mosRouter.js
  do
  node -c "$file"
done

if ! grep -q '^IXI_MOS_INTERNAL_AUTH_ENFORCE=true' .env; then
  echo "ERROR: IXI MOS internal authentication enforcement is not enabled." >&2
  exit 1
fi

if ! grep -q '^IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT=' .env; then
  echo "ERROR: Passport entity enforcement epoch is missing." >&2
  exit 1
fi

set -a
source .env
set +a

node integrity/creationIntegrityWorker.js

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-enabled --quiet ixi-aos-creation-integrity.timer
  systemctl is-active --quiet ixi-aos-creation-integrity.timer
fi

echo "IXI AOS LIVE CREATION INTEGRITY VERIFIED"
