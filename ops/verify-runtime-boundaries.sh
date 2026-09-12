#!/usr/bin/env bash
set -Eeuo pipefail

LIVE_ROOT="${IXI_LIVE_ROOT:-/var/www/ix-core}"
PASSPORT_FILE="${IXI_PASSPORT_DATA_FILE:-$LIVE_ROOT/passport/passports.json}"
SQLITE_FILE="${IXI_MOS_SQLITE_PATH:-/var/lib/ixi-core/mos/ixi-aos.sqlite}"

test -f "$LIVE_ROOT/index.js"
test -f "$PASSPORT_FILE"
test -f "$SQLITE_FILE"

sudo -u ubuntu test -r "$PASSPORT_FILE"
sudo -u ubuntu test -w "$(dirname "$PASSPORT_FILE")"
sudo -u ubuntu test -r "$SQLITE_FILE"
sudo -u ubuntu test -w "$(dirname "$SQLITE_FILE")"

test ! -e "$PASSPORT_FILE.lock"

curl --max-time 5 -fsS http://127.0.0.1:4100/live >/dev/null
curl --max-time 10 -fsS http://127.0.0.1:4100/ready >/dev/null

echo "IX-Core runtime boundaries verified."

