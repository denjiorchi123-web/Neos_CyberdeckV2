#!/bin/sh
# /usr/local/bin/usb-mount.sh
set -eu

DEVNAME="/dev/$1"
FSTYPE="${2:-}"
LABEL="${3:-}"
MOUNT_BASE="/media"
LOCK="/tmp/usb-automount.lock"

# Guard script execution block against double udev-race triggers
exec 9>"$LOCK"
flock -x 9

# Prevent re-mounting if already active
if mountpoint -q "$DEVNAME" 2>/dev/null; then
    exit 0
fi

# Pick the first free generic mount directory slot
MOUNT_POINT=""
for n in 0 1 2 3 4 5 6 7; do
    MP="$MOUNT_BASE/usb$n"
    if ! mountpoint -q "$MP" 2>/dev/null; then
        MOUNT_POINT="$MP"
        break
    fi
done

if [ -z "$MOUNT_POINT" ]; then
    echo "[usb-mount] No free slot available for $DEVNAME" >&2
    exit 1
fi

# Sanitize custom device labels if provided
if [ -n "$LABEL" ]; then
    SAFE_LABEL=$(echo "$LABEL" | tr -cd 'A-Za-z0-9_-' | cut -c1-32)
    if [ -n "$SAFE_LABEL" ]; then
        ALT_MP="$MOUNT_BASE/$SAFE_LABEL"
        if ! mountpoint -q "$ALT_MP" 2>/dev/null && [ ! -d "$ALT_MP" ]; then
            MOUNT_POINT="$ALT_MP"
        fi
    fi
fi

mkdir -p "$MOUNT_POINT"

# Discover the filesystem type safely if dropped by upstream layers
if [ -z "$FSTYPE" ]; then
    FSTYPE=$(blkid -o value -s TYPE "$DEVNAME" 2>/dev/null || echo "auto")
fi

# Prepare mount option arguments
MNT_OPTS="rw,noatime"
case "$FSTYPE" in
    vfat|fat32|fat16|msdos)
        MNT_OPTS="rw,noatime,uid=1200,gid=1200,umask=022,utf8"
        MNT_TYPE="vfat"
        ;;
    exfat)
        MNT_OPTS="rw,noatime,uid=1200,gid=1200,umask=022"
        MNT_TYPE="exfat"
        ;;
    ntfs|ntfs-3g)
        # Try high-performance native ntfs3 kernel module first
        MNT_OPTS="rw,noatime,uid=1200,gid=1200,umask=022"
        MNT_TYPE="ntfs3"
        ;;
    iso9660|udf)
        MNT_OPTS="ro,noatime"
        MNT_TYPE="$FSTYPE"
        ;;
    *)
        MNT_TYPE="auto"
        ;;
esac

# FIXED: Escapes udev systemd sandbox space by issuing transient service scheduling
# This forces the mounting operation to process inside the global host namespace context.
if [ "$MNT_TYPE" = "ntfs3" ]; then
    systemd-run --no-block --property="Description=Mount $DEVNAME" \
        mount -t ntfs3 -o "$MNT_OPTS" "$DEVNAME" "$MOUNT_POINT" 2>/dev/null || \
    systemd-run --no-block --property="Description=Mount Fallback $DEVNAME" \
        mount -t ntfs -o "$MNT_OPTS" "$DEVNAME" "$MOUNT_POINT"
else
    systemd-run --no-block --property="Description=Mount $DEVNAME" \
        mount -t "$MNT_TYPE" -o "$MNT_OPTS" "$DEVNAME" "$MOUNT_POINT"
fi

# FIXED: Post-Mount Linux Filesystem Permissions Fix
# Runs an asynchronous permission alignment block for native filesystems (ext4/btrfs)
# to keep them write-accessible to the cyberdeck user.
if echo "$FSTYPE" | grep -qE "ext[234]|btrfs|xfs"; then
    (
        # Small grace wait step to make sure the transient mount finished syncing
        sleep 1
        chown -R 1200:1200 "$MOUNT_POINT"
        chmod 0755 "$MOUNT_POINT"
    ) &
fi

echo "[usb-mount] Dispatched $DEVNAME ($FSTYPE) → $MOUNT_POINT"
