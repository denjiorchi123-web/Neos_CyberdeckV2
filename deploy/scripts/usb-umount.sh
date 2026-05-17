#!/bin/sh
# Called by udev when a USB block device is removed.
# Unmounts any /media/* that was backed by this device.
set -eu

DEVNAME="/dev/$1"
MOUNT_BASE="/media"

# Find all mounts under /media/ and unmount the one backed by the removed device
if [ -f /proc/mounts ]; then
    while IFS= read -r line; do
        src=$(echo "$line" | awk '{print $1}')
        mp=$(echo  "$line" | awk '{print $2}')
        if [ "$src" = "$DEVNAME" ] && echo "$mp" | grep -q "^$MOUNT_BASE/"; then
            umount -l "$mp" 2>/dev/null || umount "$mp" 2>/dev/null || true
            echo "[usb-umount] Unmounted $mp ($DEVNAME)"
        fi
    done < /proc/mounts
fi
