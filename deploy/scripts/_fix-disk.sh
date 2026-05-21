#!/bin/bash
# Frees disk space for the Yocto build.
set -euo pipefail

YOCTO_ROOT="${YOCTO_ROOT:-$HOME/cyberdeck}"
LOCAL_CONF="$YOCTO_ROOT/build/conf/local.conf"

echo "=== Current disk state ==="
df -h /mnt/c ~

echo ""
echo "=== [1] Adding rm_work to local.conf (auto-cleans build dirs after each package) ==="
if grep -q 'rm_work' "$LOCAL_CONF"; then
  echo "rm_work already set"
else
  echo '' >> "$LOCAL_CONF"
  echo '# Auto-delete work dirs after each recipe builds — cuts TMPDIR from 80GB to ~15GB' >> "$LOCAL_CONF"
  echo 'INHERIT += "rm_work"' >> "$LOCAL_CONF"
  echo "rm_work added"
fi

echo ""
echo "=== [2] Cleaning existing Yocto tmp (safe — sstate cache keeps everything reusable) ==="
if [ -d "$YOCTO_ROOT/tmp" ]; then
  du -sh "$YOCTO_ROOT/tmp"
  rm -rf "$YOCTO_ROOT/tmp"
  echo "tmp cleaned"
else
  echo "tmp dir not found — nothing to clean"
fi

echo ""
echo "=== [3] Pruning old sstate objects older than 30 days ==="
find "$YOCTO_ROOT/sstate-cache" -name '*.tgz' -mtime +30 -delete 2>/dev/null && echo "old sstate pruned" || echo "nothing old to prune"

echo ""
echo "=== [4] Cleaning apt cache in WSL ==="
sudo apt-get clean -y 2>/dev/null && echo "apt cache cleaned"

echo ""
echo "=== Disk state after cleanup ==="
df -h /mnt/c ~

echo ""
echo "=== Yocto dir sizes after cleanup ==="
du -sh "$YOCTO_ROOT/downloads"    2>/dev/null || echo "downloads: 0"
du -sh "$YOCTO_ROOT/sstate-cache" 2>/dev/null || echo "sstate: 0"
du -sh "$YOCTO_ROOT/tmp"          2>/dev/null || echo "tmp: 0 (cleaned)"

echo ""
echo "Done. C: drive space is freed inside WSL."
echo "To also reclaim space in Windows, run in PowerShell (as Admin):"
echo "  wsl --shutdown"
echo "  Optimize-VHD -Path (Get-ChildItem \$env:LOCALAPPDATA\\Packages\\*Ubuntu*\\LocalState\\ext4.vhdx).FullName -Mode Full"
