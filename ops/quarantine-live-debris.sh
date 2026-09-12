#!/usr/bin/env bash
set -Eeuo pipefail

LIVE_ROOT="${IXI_LIVE_ROOT:-/var/www/ix-core}"
MODE="${1:-}"

if [[ "$MODE" != "--apply" ]]; then
  echo "Refusing mutation. Re-run with --apply after reviewing the audit output." >&2
  exit 2
fi

test "$(readlink -f "$LIVE_ROOT")" = "/var/www/ix-core"
test -f "$LIVE_ROOT/index.js"
test -f "$LIVE_ROOT/passport/passports.json"

QUARANTINE_ROOT="/var/backups/ixi-core-quarantine/$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 -o root -g root "$QUARANTINE_ROOT"
MANIFEST="$(mktemp)"
trap 'rm -f -- "$MANIFEST"' EXIT

add_candidate() {
  local path="$1"
  [[ -f "$path" ]] || return 0
  printf '%s\n' "$path" >> "$MANIFEST"
}

# Exact zero-byte shell accidents observed on the live host. A non-empty file
# fails closed and is never moved by this rule.
for name in 1 336-FL 336FL 336FLN 336GC 580SL CCG JOB Jobs SD115B '{'; do
  path="$LIVE_ROOT/$name"
  if [[ -f "$path" && ! -s "$path" ]]; then
    add_candidate "$path"
  fi
done

# Historical single-file patches are not loaded by Node because index.js is
# the only PM2 entry point. They are retained in a checksummed quarantine.
while IFS= read -r path; do
  add_candidate "$path"
done < <(find "$LIVE_ROOT" -maxdepth 1 -type f \
  \( -name 'index.js.before-*' -o -name 'index.js.bak-*' -o -name 'index.js.backup-*' \) \
  -print | sort)

# Old environment snapshots can contain credentials. Quarantine them with
# root-only permissions; never print or delete their contents.
while IFS= read -r path; do
  add_candidate "$path"
done < <(find "$LIVE_ROOT" -maxdepth 1 -type f -name '.env.before-*' -print | sort)

sort -u -o "$MANIFEST" "$MANIFEST"
if [[ ! -s "$MANIFEST" ]]; then
  echo "No verified debris candidates found."
  exit 0
fi

echo "===== QUARANTINE CANDIDATES ====="
while IFS= read -r path; do
  stat -c '%A %U:%G %s %n' "$path"
done < "$MANIFEST"

echo "===== CAPTURE CHECKSUMS ====="
sudo sh -c ': > "$1/manifest.sha256"' sh "$QUARANTINE_ROOT"
while IFS= read -r path; do
  digest="$(sudo sha256sum "$path" | awk '{print $1}')"
  relative="${path#"$LIVE_ROOT"/}"
  printf '%s  %s\n' "$digest" "$relative" | sudo tee -a "$QUARANTINE_ROOT/manifest.sha256" >/dev/null
done < "$MANIFEST"

echo "===== MOVE TO RECOVERABLE QUARANTINE ====="
while IFS= read -r path; do
  relative="${path#"$LIVE_ROOT"/}"
  sudo install -d -m 0700 -o root -g root "$QUARANTINE_ROOT/$(dirname "$relative")"
  sudo mv -- "$path" "$QUARANTINE_ROOT/$relative"
done < "$MANIFEST"

sudo chmod -R go-rwx "$QUARANTINE_ROOT"
echo "quarantine=$QUARANTINE_ROOT"
echo "No database, Passport registry, active runtime file, node_modules, or backup was deleted."

