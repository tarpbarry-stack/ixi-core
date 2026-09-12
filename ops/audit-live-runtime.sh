#!/usr/bin/env bash
set -Eeuo pipefail

LIVE_ROOT="${IXI_LIVE_ROOT:-/var/www/ix-core}"

test -d "$LIVE_ROOT"
test -f "$LIVE_ROOT/index.js"

echo "===== ACTIVE RUNTIME ====="
pm2 describe IX-Core | sed -n '/status/,/watching/p'

echo "===== CAPACITY ====="
df -h "$LIVE_ROOT"
du -xhd1 "$LIVE_ROOT" /var/backups /var/log /home/ubuntu/.npm 2>/dev/null | sort -h

echo "===== WRITABLE RUNTIME BOUNDARIES ====="
for path in \
  "$LIVE_ROOT" \
  "$LIVE_ROOT/passport" \
  /var/lib/ixi-core \
  /var/lib/ixi-core/mos
do
  if [[ -e "$path" ]]; then
    stat -c '%A %U:%G %s %n' "$path"
    if sudo -u ubuntu test -w "$path"; then
      echo "writable-by-ubuntu $path"
    else
      echo "NOT-writable-by-ubuntu $path"
    fi
  else
    echo "missing $path"
  fi
done

echo "===== TOP-LEVEL UNTRACKED-SHAPE FILES ====="
find "$LIVE_ROOT" -maxdepth 1 -type f \
  \( -size 0 -o -name '*.bak*' -o -name '*.before-*' -o -name '*.backup-*' \) \
  -printf '%TY-%Tm-%TdT%TH:%TM:%TSZ | %s | %u:%g | %p\n' | sort

echo "===== RELEASE AND BACKUP AREAS ====="
find "$LIVE_ROOT/backups" /var/backups /tmp -maxdepth 2 \
  \( -type d -o -type f \) \
  \( -name '*ixi*' -o -name '*transact*' \) 2>/dev/null \
  | sort

echo "===== HEALTH ====="
curl --max-time 10 -fsS http://127.0.0.1:4100/live || true
echo
curl --max-time 20 -fsS http://127.0.0.1:4100/ready || \
  curl --max-time 20 -fsS http://127.0.0.1:4100/health || true
echo
