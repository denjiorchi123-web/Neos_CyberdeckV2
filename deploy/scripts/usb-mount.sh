#!/bin/sh
# Called by udev: usb-mount.sh <devname> [fstype] [label]
# e.g.  usb-mount.sh sda1 vfat MYUSB
#
# udev passes fstype and label directly so we never need to call blkid
# (which races with udev on kernel < 5.15 and some Pi firmware versions).
set -eu

DEV="$1"
FSTYPE="${2:-}"
LABEL="${3:-}"
DEVNAME="/dev/$DEV"
MOUNT_BASE="/media"
LOCK="/run/usb-mount.lock"

# Wait for the device node to actually exist (udev can fire slightly early)
i=0
while [ ! -b "$DEVNAME" ] && [ $i -lt 10 ]; do
  sleep 0.2
  i=$((i + 1))
done
[ -b "$DEVNAME" ] || { echo "[usb-mount] $DEVNAME never appeared" >&2; exit 1; }

# Serialise concurrent hotplug events
( flock -x 9

  # Pick the first free slot
  MOUNT_POINT=""
  for n in 0 1 2 3 4 5 6 7; do
    MP="$MOUNT_BASE/usb$n"
    if ! mountpoint -q "$MP" 2>/dev/null; then
      MOUNT_POINT="$MP"
      break
    fi
  done

  if [ -z "$MOUNT_POINT" ]; then
    echo "[usb-mount] No free slot for $DEVNAME" >&2
    exit 1
  fi

  mkdir -p "$MOUNT_POINT"

  # Detect fstype if udev didn't provide it
  if [ -z "$FSTYPE" ]; then
    FSTYPE=$(blkid -o value -s TYPE "$DEVNAME" 2>/dev/null || echo "auto")
  fi

  # Use a safe label for the mount point name if one was provided
  if [ -n "$LABEL" ]; then
    SAFE_LABEL=$(echo "$LABEL" | tr -cd 'A-Za-z0-9_-' | cut -c1-32)
    if [ -n "$SAFE_LABEL" ]; then
      ALT_MP="$MOUNT_BASE/$SAFE_LABEL"
      if ! mountpoint -q "$ALT_MP" 2>/dev/null && [ ! -d "$ALT_MP" ]; then
        MOUNT_POINT="$ALT_MP"
        mkdir -p "$MOUNT_POINT"
      fi
    fi
  fi

  case "$FSTYPE" in
    vfat|fat32|fat16|msdos)
      mount -t vfat -o rw,noatime,uid=1000,gid=1000,umask=022,utf8 \
            "$DEVNAME" "$MOUNT_POINT"
      ;;
    exfat)
      mount -t exfat -o rw,noatime,uid=1000,gid=1000,umask=022 \
            "$DEVNAME" "$MOUNT_POINT"
      ;;
    ntfs|ntfs-3g)
      mount -t ntfs3 -o rw,noatime,uid=1000,gid=1000,umask=022 \
            "$DEVNAME" "$MOUNT_POINT" 2>/dev/null \
      || mount -t ntfs -o rw,noatime,uid=1000,gid=1000,umask=022 \
               "$DEVNAME" "$MOUNT_POINT"
      ;;
    ext4|ext3|ext2|btrfs|xfs)
      mount -o rw,noatime "$DEVNAME" "$MOUNT_POINT"
      ;;
    iso9660|udf)
      mount -o ro,noatime "$DEVNAME" "$MOUNT_POINT"
      ;;
    *)
      mount -o rw,noatime "$DEVNAME" "$MOUNT_POINT" \
      || mount -o ro       "$DEVNAME" "$MOUNT_POINT"
      ;;
  esac

  echo "[usb-mount] $DEVNAME ($FSTYPE) → $MOUNT_POINT"

) 9>"$LOCK"
