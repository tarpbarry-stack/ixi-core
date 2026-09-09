#!/usr/bin/env bash
set -Eeuo pipefail

LIVE_ROOT="${IXI_LIVE_ROOT:-/var/www/ix-core}"
REPOSITORY="${IXI_RELEASE_REPOSITORY:-https://github.com/tarpbarry-stack/ixi-core.git}"
RELEASE_SHA="${IXI_RELEASE_SHA:-60ee9f0a301c98fce22e12d9d9afe7a4b0b77fb2}"
RELEASE_TREE="${IXI_RELEASE_TREE:-d4b214abd060d9c2a48881950012ab48cb83bd9d}"
INSTANCE_ID="$(hostname)"
LOCK_FILE="/tmp/ixi-transact-commercial-release.lock"
STAGE_ROOT=""
BACKUP_ROOT=""
DEPLOY_STARTED=0

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "DEPLOYMENT STOPPED — another IX-Core release is active."
  exit 1
fi

cleanup() {
  if [[ -n "$STAGE_ROOT" && -d "$STAGE_ROOT" ]]; then
    rm -rf -- "$STAGE_ROOT"
  fi
}

rollback() {
  local rc=$?
  trap - ERR
  set +e
  if [[ "$DEPLOY_STARTED" -eq 1 && -n "$BACKUP_ROOT" ]]; then
    echo "RELEASE FAILED — restoring the previous IX-Core code."
    pm2 stop IX-Core >/dev/null 2>&1
    sudo tar -xzf "$BACKUP_ROOT/code-before.tar.gz" -C "$LIVE_ROOT"
    if [[ -s "$BACKUP_ROOT/new-release-paths.txt" ]]; then
      while IFS= read -r path; do
        [[ -n "$path" ]] && sudo rm -f -- "$LIVE_ROOT/$path"
      done < "$BACKUP_ROOT/new-release-paths.txt"
    fi
    pm2 restart IX-Core --update-env >/dev/null 2>&1
    curl --max-time 10 -fsS http://127.0.0.1:4100/health || true
    echo
    echo "Previous code restored. Identity and SQLite backups remain at $BACKUP_ROOT"
  fi
  cleanup
  exit "$rc"
}

trap rollback ERR
trap cleanup EXIT

test -d "$LIVE_ROOT"
test -f "$LIVE_ROOT/.env"
test -d "$LIVE_ROOT/node_modules"
test -f "$LIVE_ROOT/passport/passports.json"

AVAILABLE_KB="$(df -Pk "$LIVE_ROOT" | awk 'NR==2 {print $4}')"
if [[ ! "$AVAILABLE_KB" =~ ^[0-9]+$ ]] || (( AVAILABLE_KB < 1048576 )); then
  echo "DEPLOYMENT STOPPED — at least 1 GiB of free disk is required."
  df -h "$LIVE_ROOT"
  exit 1
fi

STAGE_ROOT="$(mktemp -d /tmp/ixi-transact-commercial-XXXXXXXX)"
RELEASE_ROOT="$STAGE_ROOT/release"

echo "===== ACQUIRE EXACT RELEASE ====="
git clone --quiet --filter=blob:none --no-checkout "$REPOSITORY" "$RELEASE_ROOT"
git -C "$RELEASE_ROOT" checkout --quiet --detach "$RELEASE_SHA"
test "$(git -C "$RELEASE_ROOT" rev-parse HEAD)" = "$RELEASE_SHA"
test "$(git -C "$RELEASE_ROOT" rev-parse HEAD^{tree})" = "$RELEASE_TREE"
ln -s "$LIVE_ROOT/node_modules" "$RELEASE_ROOT/node_modules"

echo "===== TEST EXACT RELEASE ====="
NODE_PATH="$LIVE_ROOT/node_modules" node --test \
  "$RELEASE_ROOT/financial/IXIFinancialDashboardRequestContract.test.js" \
  "$RELEASE_ROOT/financial/IXIFinancialDashboardRoute.test.js" \
  "$RELEASE_ROOT/mos/tests/authenticatedWorkspaceHttp.test.js" \
  "$RELEASE_ROOT/mos/tests/relationshipIdentityEvidence.test.js" \
  "$RELEASE_ROOT/mos/tests/sessionPlacement.test.js"

BACKUP_ROOT="$LIVE_ROOT/backups/releases/transact-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_ROOT/database"
chmod 700 "$BACKUP_ROOT"

git -C "$RELEASE_ROOT" ls-tree -r --name-only "$RELEASE_SHA" > "$BACKUP_ROOT/release-paths.txt"
: > "$BACKUP_ROOT/existing-release-paths.txt"
: > "$BACKUP_ROOT/new-release-paths.txt"
while IFS= read -r path; do
  if [[ -e "$LIVE_ROOT/$path" ]]; then
    printf '%s\n' "$path" >> "$BACKUP_ROOT/existing-release-paths.txt"
  else
    printf '%s\n' "$path" >> "$BACKUP_ROOT/new-release-paths.txt"
  fi
done < "$BACKUP_ROOT/release-paths.txt"

echo "===== BACKUP CODE, SQLITE, AND PASSPORTS ====="
tar -czf "$BACKUP_ROOT/code-before.tar.gz" \
  -C "$LIVE_ROOT" \
  -T "$BACKUP_ROOT/existing-release-paths.txt"
cp -a "$LIVE_ROOT/passport/passports.json" "$BACKUP_ROOT/passports.before.json"
sha256sum "$BACKUP_ROOT/passports.before.json" > "$BACKUP_ROOT/passports.before.sha256"

(
  cd "$LIVE_ROOT"
  IXI_MOS_BACKUP_ROOT="$BACKUP_ROOT/database" \
  IXI_MOS_BACKUP_S3_BUCKET= \
  node -r dotenv/config mos/storage/backupSqlite.js
) | tee "$BACKUP_ROOT/sqlite-backup.json"

echo "===== STOP AND CAPTURE IDENTITY CENSUS ====="
pm2 stop IX-Core
(
  cd "$LIVE_ROOT"
  node -r dotenv/config - <<'NODE'
const crypto = require("node:crypto");
const { listObjects } = require("./mos/objects/objectService");
const { readPassportRecords } = require("./passport/passportRegistry");
const objects = listObjects({ status: null });
const passports = readPassportRecords();
const objectData = objects
  .map(({ updatedAt, ...record }) => record)
  .sort((left, right) => String(left.objectId).localeCompare(String(right.objectId)));
const identity = passports
  .map(({ updatedAt, ...record }) => record)
  .sort((left, right) => String(left.passportId).localeCompare(String(right.passportId)));
console.log(JSON.stringify({
  objects: objects.length,
  activeObjects: objects.filter(record => record.status === "active").length,
  passports: passports.length,
  objectDataHash: crypto.createHash("sha256").update(JSON.stringify(objectData)).digest("hex"),
  identityHash: crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}, null, 2));
NODE
) | tee "$BACKUP_ROOT/census.before.json"

echo "===== INSTALL COMPLETE RELEASE ====="
DEPLOY_STARTED=1
git -C "$RELEASE_ROOT" archive --format=tar "$RELEASE_SHA" | \
  sudo tar --owner=ubuntu --group=ubuntu -xf - -C "$LIVE_ROOT"

node --check "$LIVE_ROOT/index.js"
node --check "$LIVE_ROOT/mos/routes/mosRouter.js"
node --check "$LIVE_ROOT/financial/IXIFinancialRoutes.js"
node --check "$LIVE_ROOT/financial/IXIFinancialDashboardRequestContract.js"

echo "===== VERIFY INSTALLED TREE ====="
while IFS= read -r path; do
  expected="$(git -C "$RELEASE_ROOT" rev-parse "$RELEASE_SHA:$path")"
  actual="$(git hash-object "$LIVE_ROOT/$path")"
  if [[ "$expected" != "$actual" ]]; then
    echo "Installed file mismatch: $path"
    exit 1
  fi
done < "$BACKUP_ROOT/release-paths.txt"

echo "===== START AND VERIFY HEALTH ====="
pm2 restart IX-Core --update-env
READY=0
for attempt in $(seq 1 30); do
  if curl --max-time 5 -fsS http://127.0.0.1:4100/health > "$BACKUP_ROOT/health.json"; then
    READY=1
    break
  fi
  sleep 1
done
test "$READY" -eq 1
cat "$BACKUP_ROOT/health.json"
echo

(
  cd "$LIVE_ROOT"
  node -r dotenv/config - <<'NODE'
const crypto = require("node:crypto");
const { listObjects } = require("./mos/objects/objectService");
const { readPassportRecords } = require("./passport/passportRegistry");
const objects = listObjects({ status: null });
const passports = readPassportRecords();
const objectData = objects
  .map(({ updatedAt, ...record }) => record)
  .sort((left, right) => String(left.objectId).localeCompare(String(right.objectId)));
const identity = passports
  .map(({ updatedAt, ...record }) => record)
  .sort((left, right) => String(left.passportId).localeCompare(String(right.passportId)));
console.log(JSON.stringify({
  objects: objects.length,
  activeObjects: objects.filter(record => record.status === "active").length,
  passports: passports.length,
  objectDataHash: crypto.createHash("sha256").update(JSON.stringify(objectData)).digest("hex"),
  identityHash: crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}, null, 2));
NODE
) | tee "$BACKUP_ROOT/census.after.json"

diff -u "$BACKUP_ROOT/census.before.json" "$BACKUP_ROOT/census.after.json"

DEPLOY_STARTED=0
trap - ERR

echo "===== IX-CORE TRANSACT COMMERCIAL RELEASE ONLINE ====="
echo "instance=$INSTANCE_ID"
echo "release=$RELEASE_SHA"
echo "tree=$RELEASE_TREE"
echo "backup=$BACKUP_ROOT"
pm2 status IX-Core
