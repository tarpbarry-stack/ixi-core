#!/usr/bin/env bash
# This entry point is called only by the paired, authenticated release workflow.
set -Eeuo pipefail
umask 077
: "${IXI_CORE_SHA:?An immutable backend commit is required}"
: "${IXI_RECOVERY_BUCKET:?Verified private recovery bucket is required}"
: "${IXI_RECOVERY_ACCOUNT_ID:?Expected account is required}"
[[ "$IXI_CORE_SHA" =~ ^[a-f0-9]{40}$ ]]
APP=/var/www/ix-core
export IXI_LIVE_ROOT="$APP"
export IXI_MOS_SQLITE_PATH=/var/lib/ixi-core/mos/ixi-aos.sqlite
BACKUP_ROOT=/var/backups/ixi-core-releases
mkdir -p "$BACKUP_ROOT"
exec 9>/var/lock/ixi-core-production.lock
flock -n 9 || { echo "Another IX-Core release holds the deployment lock." >&2; exit 1; }
test -f "$APP/index.js"
test -f "$APP/passport/passports.json"
test -f "$IXI_MOS_SQLITE_PATH"
STAGE="$(mktemp -d /var/tmp/ixi-complete-release-XXXXXXXX)"
chown ubuntu:ubuntu "$STAGE"
run_pm2() { sudo -u ubuntu -H pm2 "$@"; }
run_stage() { sudo -u ubuntu -H bash -c 'cd "$1"; shift; exec "$@"' _ "$STAGE" "$@"; }
run_stage git init -q
run_stage git remote add origin https://github.com/tarpbarry-stack/ixi-core.git
run_stage git fetch -q --depth=1 origin "$IXI_CORE_SHA"
run_stage git checkout -q --detach FETCH_HEAD
test "$(run_stage git rev-parse HEAD)" = "$IXI_CORE_SHA"
run_stage npm ci --no-audit --no-fund
if ! run_stage npm test > "$STAGE/test-results.log" 2>&1; then
  tail -100 "$STAGE/test-results.log"
  exit 1
fi
tail -9 "$STAGE/test-results.log"
run_stage node "$STAGE/ops/runtime-release.js" create "$STAGE" "$IXI_CORE_SHA" > "$STAGE/release.json"
node "$STAGE/ops/runtime-release.js" verify "$STAGE" "$STAGE/release.json"
# Check remote recovery access before stopping a healthy service.
sudo -u ubuntu -H env AWS_REGION="$AWS_REGION" IXI_RECOVERY_BUCKET="$IXI_RECOVERY_BUCKET" \
  IXI_RECOVERY_ACCOUNT_ID="$IXI_RECOVERY_ACCOUNT_ID" node "$STAGE/ops/backup-to-s3.js" --preflight
sudo -u ubuntu -H env AWS_REGION="$AWS_REGION" node "$STAGE/ops/verify-runtime-capabilities.js"

run_pm2 jlist > "$STAGE/processes.json"
mapfile -t ACTIVE < <(python3 - "$STAGE/processes.json" <<'PY'
import json,sys
processes=json.load(open(sys.argv[1]))
core=[p for p in processes if p.get('name')=='IX-Core']
if len(core)!=1 or core[0]['pm2_env']['status']!='online':
    raise SystemExit("IX-Core must have one known online process before release")
for p in processes:
    if p.get('name') in ['IX-Core','IXI-Media-Worker'] and p['pm2_env']['status']=='online':
        print(p['name'])
PY
)
test "${#ACTIVE[@]}" -ge 1
TIMER_ACTIVE=0
if systemctl is-active --quiet ixi-aos-creation-integrity.timer; then TIMER_ACTIVE=1; fi
STOPPED=0
INSTALLED=0
DEPENDENCIES=0
SUCCESS=0
ROLLBACK="$BACKUP_ROOT/source-before-$IXI_CORE_SHA-$(date -u +%Y%m%dT%H%M%SZ)"
finish() {
  local status=$?
  trap - EXIT
  if [[ "$SUCCESS" -ne 1 && "$INSTALLED" -eq 1 && -f "$ROLLBACK/rollback.json" ]]; then
    run_pm2 stop "${ACTIVE[@]}" >/dev/null || true
    python3 "$STAGE/ops/install-runtime-release.py" rollback --app "$APP" --backup "$ROLLBACK" || status=1
    if [[ "$DEPENDENCIES" -eq 1 ]]; then
      if [[ -d "$APP/node_modules" ]]; then mv "$APP/node_modules" "$STAGE/failed-node_modules"; fi
      mv "$ROLLBACK/node_modules" "$APP/node_modules"
    fi
  fi
  if [[ "$STOPPED" -eq 1 && "$SUCCESS" -ne 1 ]]; then
    run_pm2 restart "${ACTIVE[@]}" >/dev/null || status=1
  fi
  if [[ "$TIMER_ACTIVE" -eq 1 ]]; then systemctl start ixi-aos-creation-integrity.timer || status=1; fi
  if [[ "$status" -ne 0 ]]; then echo "Release failed; inspect the workflow and retained rollback set: $ROLLBACK" >&2; fi
  exit "$status"
}
trap finish EXIT
if [[ "$TIMER_ACTIVE" -eq 1 ]]; then
  systemctl stop ixi-aos-creation-integrity.timer
fi
systemctl stop ixi-aos-creation-integrity.service
STOPPED=1
run_pm2 stop "${ACTIVE[@]}" >/dev/null

# Root captures the protected files; the process role performs the private S3 upload.
# The backup helper never prints environment or credential contents.
IXI_RECOVERY_LOCAL_ROOT="$BACKUP_ROOT" node "$STAGE/ops/backup-to-s3.js" --writers-stopped > "$STAGE/recovery-receipt.json"
python3 - "$STAGE/recovery-receipt.json" <<'PY'
import json,sys
receipt=json.load(open(sys.argv[1]))
assert receipt['ok'] and receipt['versionId']
assert receipt['consistency']=='quiesced-runtime'
print(json.dumps({'backupVerified':True,'bucket':receipt['bucket'],'key':receipt['key'],
 'versionId':receipt['versionId'],'census':receipt['census']}))
PY

# Install the complete source manifest. Runtime data paths are rejected by the installer.
INSTALLED=1
python3 "$STAGE/ops/install-runtime-release.py" install --stage "$STAGE" --app "$APP" \
  --manifest "$STAGE/release.json" --backup "$ROLLBACK"
mv "$APP/node_modules" "$ROLLBACK/node_modules"
DEPENDENCIES=1
mv "$STAGE/node_modules" "$APP/node_modules"
node "$APP/ops/runtime-release.js" verify "$APP" "$APP/.ixi-release.json"
run_pm2 restart "${ACTIVE[@]}" >/dev/null
healthy=0
for attempt in {1..15}; do
  if curl --max-time 3 -fsS http://127.0.0.1:4100/live >/dev/null &&
     curl --max-time 5 -fsS http://127.0.0.1:4100/ready >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" -eq 1
for route in /communications/v1/passports/IXIWQMZWAE/email /financial/commands/desktop/journals/release-probe/post; do
  code="$(curl --max-time 5 -sS -o "$STAGE/protected-route.json" -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:4100$route")"
  [[ "$code" = 401 || "$code" = 403 ]]
done
node "$APP/ops/runtime-release.js" verify "$APP" "$APP/.ixi-release.json"
cp "$STAGE/recovery-receipt.json" "$ROLLBACK/recovery-receipt.json"
python3 - "$APP" "$IXI_MOS_SQLITE_PATH" "$STAGE/recovery-receipt.json" <<'PY'
import importlib.util,json,pathlib,sys
app=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('recovery',app/'ops/runtime-recovery.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
before=json.load(open(sys.argv[3]))['census']
after=module.census(sys.argv[2],json.loads((app/'passport/passports.json').read_text()))
for key in ['activeIdentitySha256','objects','activeObjects','passports']:
    assert after[key]==before[key], 'Canonical census changed during release: '+key
for key in ['objects.json','relationships.json']:
    assert after['collectionChecksums'].get(key)==before['collectionChecksums'].get(key), 'Business collection changed during release: '+key
print(json.dumps({'identityAndRelationshipsUnchanged':True,'activeObjects':after['activeObjects'],'passports':after['passports']}))
PY
SUCCESS=1
install -m 0644 "$APP/ops/systemd/ixi-core-recovery.service" /etc/systemd/system/ixi-core-recovery.service
install -m 0644 "$APP/ops/systemd/ixi-core-recovery.timer" /etc/systemd/system/ixi-core-recovery.timer
NODE_BIN="$(command -v node)"
sed -i "s|/usr/bin/node|$NODE_BIN|g" /etc/systemd/system/ixi-core-recovery.service
cat > /etc/ixi-recovery.env <<ENV
AWS_REGION=$AWS_REGION
IXI_RECOVERY_BUCKET=$IXI_RECOVERY_BUCKET
IXI_RECOVERY_ACCOUNT_ID=$IXI_RECOVERY_ACCOUNT_ID
IXI_LIVE_ROOT=$APP
IXI_MOS_SQLITE_PATH=$IXI_MOS_SQLITE_PATH
ENV
chmod 0600 /etc/ixi-recovery.env
systemctl daemon-reload
systemctl enable --now ixi-core-recovery.timer
flock -u 9
if ! systemctl start ixi-core-recovery.service; then
  journalctl -u ixi-core-recovery.service -n 25 --no-pager -o cat >&2
  exit 1
fi
systemctl is-active --quiet ixi-core-recovery.timer
printf 'Complete IX-Core release verified: %s\n' "$IXI_CORE_SHA"
