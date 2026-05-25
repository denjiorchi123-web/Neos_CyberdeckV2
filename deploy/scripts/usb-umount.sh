#!/bin/sh
# /usr/local/bin/usb-umount.sh
# Called by udev when a USB block device is removed.
set -eu

DEVNAME="/dev/$1"
MOUNT_BASE="/media"
LOCK="/tmp/usb-automount.lock"

# Guard script execution against mounting race windows
exec 9>"$LOCK"
flock -x 9

if [ -f /proc/mounts ]; then
    # FIXED: Decode octal paths natively (\040) using python to prevent parameter splitting
    python3 -c "
import sys
with open('/proc/mounts', 'r') as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) >= 2:
            src = parts[0]
            # Convert octal sequences like \040 back to literal string chars
            mp = parts[1].encode().decode('unicode_escape')
            if src == '$DEVNAME' and mp.startswith('$MOUNT_BASE/'):
                print(mp)
" | while IFS= read -r target_mp; do
        
        # Issue lazy unmount to drop stale device handles instantly
        if umount -l "$target_mp" 2>/dev/null; then
            echo "[usb-umount] Lazy unmounted: $target_mp ($DEVNAME)"
            
            # FIXED: Post-unmount cleanup to prevent slot orphaning
            # Since lazy unmount unlinks the filesystem instantly, we can clean up
            # the stale directory safely.
            if [ "$target_mp" != "$MOUNT_BASE" ] && [ -d "$target_mp" ]; then
                rmdir "$target_mp" 2>/dev/null || true
            fi
        fi
    done
fi
