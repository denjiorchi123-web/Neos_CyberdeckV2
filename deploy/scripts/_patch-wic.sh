#!/bin/bash
# Patches an existing CyberDeck .wic image in-place with the post-bake fixes
# that DON'T require re-building any packages:
#   - boot/config.txt PCIe disable (silences boot error)
#   - Plymouth theme files (custom boot logo, chained from firmware splash)
#   - /boot/splash.png firmware logo
#   - systemd default.target -> graphical.target (kiosk reaches WantedBy)
#   - mask getty@tty1 so weston can take the VT
#   - cyberdeck-identity.sh mkdir /data fix
#
# Cannot patch:
#   - chromium-x11 -> chromium-ozone-wayland (different binary; re-bake required)
#   - the redis.ts build guard (lives inside compiled .next bundle on p3)
#
# Run from Windows:
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/scripts/_patch-wic.sh
set -euo pipefail

PROJ=/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS
WIC_WIN=/mnt/c/Users/brije/Downloads/cyberdeck-image-cyberdeck-pi5.wic
WIC_LOCAL="$HOME/cyberdeck-image-cyberdeck-pi5.wic"

if [ "$EUID" -ne 0 ]; then
  echo "[patch-wic] re-exec under sudo for losetup/mount..."
  exec sudo -E bash "$0" "$@"
fi

# ── Ensure required tools ───────────────────────────────────────────────
need=(parted losetup mount umount)
missing=()
for t in "${need[@]}"; do
  command -v "$t" >/dev/null 2>&1 || missing+=("$t")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "[patch-wic] installing: ${missing[*]}"
  # apt-get update may fail due to broken third-party repos / arch mismatches —
  # don't let that kill the script; the install will still try cached lists.
  apt-get update -qq 2>/dev/null || echo "[patch-wic] (apt-get update non-zero, continuing)"
  apt-get install -y --no-install-recommends parted util-linux mount dosfstools \
    || { echo "[patch-wic] apt-get install failed — fix apt sources first"; exit 1; }
  # Re-verify
  for t in "${need[@]}"; do
    command -v "$t" >/dev/null 2>&1 || { echo "[patch-wic] still missing: $t"; exit 1; }
  done
fi

# ── Copy .wic to native ext4 (loop-mounting from /mnt/c is unreliable) ──
echo "[1/7] Copying .wic from Windows -> $WIC_LOCAL (this takes ~30s for 4 GB)..."
cp -f "$WIC_WIN" "$WIC_LOCAL"

# Backup the original on the Windows side before we mutate.
if [ ! -f "${WIC_WIN}.bak" ]; then
  echo "[1b]  Saving backup at ${WIC_WIN}.bak"
  cp -f "$WIC_WIN" "${WIC_WIN}.bak"
fi

# ── Attach loopback with partition scanning ─────────────────────────────
echo "[2/7] Attaching loop device..."
LOOP=$(losetup -P -f --show "$WIC_LOCAL")
echo "      loop = $LOOP"
trap 'set +e; umount /mnt/wic_boot 2>/dev/null; umount /mnt/wic_root 2>/dev/null; losetup -d "$LOOP" 2>/dev/null' EXIT

# WSL kernel often doesn't auto-create /dev/loopNpN despite -P. Force a rescan.
sleep 1
partprobe "$LOOP" 2>/dev/null || true
command -v partx >/dev/null && partx -u "$LOOP" 2>/dev/null || true
sleep 1

parted -s "$LOOP" print | sed -n '1,15p'

P1="${LOOP}p1"   # /boot (vfat)
P2="${LOOP}p2"   # /     (ext4)

# ── Mount: prefer partition nodes; fall back to offset-based mount if WSL
#    kernel still hasn't materialised them. ──────────────────────────────
mkdir -p /mnt/wic_boot /mnt/wic_root

mount_partition() {
  local part_num="$1" target="$2" fstype="$3"
  local dev="${LOOP}p${part_num}"

  if [ -b "$dev" ]; then
    echo "      mounting $dev -> $target"
    mount -t "$fstype" -o rw "$dev" "$target"
    return
  fi

  # Fall back to offset-based mount. Read offset (in 512-byte sectors) and
  # length from parted's machine-readable output.
  echo "      $dev not present, computing offset for partition $part_num"
  local line offset_sectors size_sectors offset_bytes size_bytes
  line=$(parted -sm "$LOOP" unit s print | awk -F: -v n="$part_num" '$1==n')
  [ -n "$line" ] || { echo "ERROR: partition $part_num not in parted output"; exit 1; }
  offset_sectors=$(echo "$line" | cut -d: -f2 | tr -d s)
  size_sectors=$(echo   "$line" | cut -d: -f4 | tr -d s)
  offset_bytes=$(( offset_sectors * 512 ))
  size_bytes=$((   size_sectors   * 512 ))
  echo "      offset=$offset_bytes  size=$size_bytes  fs=$fstype"
  mount -t "$fstype" -o "rw,loop,offset=$offset_bytes,sizelimit=$size_bytes" \
    "$WIC_LOCAL" "$target"
}

echo "[3/7] Mounting partitions..."
mount_partition 1 /mnt/wic_boot vfat
mount_partition 2 /mnt/wic_root ext4

# ── Patch p1: /boot/config.txt PCIe section ────────────────────────────
echo "[4/7] Patching /boot/config.txt..."
CFG=/mnt/wic_boot/config.txt
if ! grep -q '^dtoverlay=disable-pcie' "$CFG"; then
  cat >> "$CFG" <<'EOF'

# ─── PCIe ──────────────────────────────────────────────────────────────
# Suppress "PCIe link down" kernel error when no NVMe/PCIe device is attached.
dtparam=nvme=off
dtoverlay=disable-pcie
EOF
  echo "      PCIe block appended"
else
  echo "      PCIe block already present"
fi

# ── Patch p1: firmware splash logo (Pi firmware loads /boot/splash.png) ─
echo "      Installing firmware splash logo..."
cp -f "$PROJ/deploy/assets/boot-logos/boot-dark.png" /mnt/wic_boot/splash.png

# ── Patch p2: Plymouth theme ───────────────────────────────────────────
echo "[5/7] Installing Plymouth theme..."
THEME=/mnt/wic_root/usr/share/plymouth/themes/cyberdeck
mkdir -p "$THEME"
cp -f "$PROJ/deploy/assets/boot-logos/boot-dark.png"    "$THEME/boot.png"
cp -f "$PROJ/deploy/yocto/snippets/cyberdeck.plymouth"  "$THEME/cyberdeck.plymouth"
cp -f "$PROJ/deploy/yocto/snippets/cyberdeck.script"    "$THEME/cyberdeck.script"

# Make cyberdeck the active theme. plymouth-set-default-theme isn't in the
# host PATH, so do its job manually by rewriting the symlink it controls.
DEFAULT_LINK=/mnt/wic_root/etc/plymouth/plymouthd.conf
mkdir -p /mnt/wic_root/etc/plymouth
cat > "$DEFAULT_LINK" <<'EOF'
[Daemon]
Theme=cyberdeck
EOF
# Some plymouth builds also read this symlink directly:
ln -sf /usr/share/plymouth/themes/cyberdeck/cyberdeck.plymouth \
       /mnt/wic_root/usr/share/plymouth/themes/default.plymouth

# ── Patch p2: systemd default.target -> graphical.target ───────────────
echo "[6/7] Setting default.target = graphical.target..."
mkdir -p /mnt/wic_root/etc/systemd/system
ln -sf /lib/systemd/system/graphical.target \
       /mnt/wic_root/etc/systemd/system/default.target

# ── Patch p2: mask getty@tty1 so weston can grab the VT ────────────────
echo "      Masking getty@tty1..."
ln -sf /dev/null /mnt/wic_root/etc/systemd/system/getty@tty1.service

# ── Patch p2: cyberdeck-identity.sh mkdir fix (locate by name) ─────────
echo "      Patching cyberdeck-identity.sh..."
IDENT=$(find /mnt/wic_root -name cyberdeck-identity.sh -type f 2>/dev/null | head -1)
if [ -n "$IDENT" ]; then
  cp -f "$PROJ/deploy/yocto/snippets/cyberdeck-identity.sh" "$IDENT"
  chmod 0755 "$IDENT"
  echo "      replaced: $IDENT"
else
  echo "      WARNING: cyberdeck-identity.sh not found on rootfs — skipped"
fi

# ── Sync & unmount ─────────────────────────────────────────────────────
echo "[7/7] Syncing + detaching..."
sync
umount /mnt/wic_boot
umount /mnt/wic_root
losetup -d "$LOOP"
trap - EXIT

# ── Copy patched .wic back to Windows ──────────────────────────────────
echo "      Copying patched image back to Windows..."
cp -f "$WIC_LOCAL" "$WIC_WIN"
ls -lh "$WIC_WIN" "${WIC_WIN}.bak"

cat <<'DONE'

========================================================
  Patch complete.

  Patched:  C:\Users\brije\Downloads\cyberdeck-image-cyberdeck-pi5.wic
  Backup:   C:\Users\brije\Downloads\cyberdeck-image-cyberdeck-pi5.wic.bak

  NOT patched (still need a re-bake before kiosk renders):
    - chromium-x11  ->  chromium-ozone-wayland
    - lib/redis.ts  build-phase guard (compiled into .next bundle)

  Flash to SD with Raspberry Pi Imager (Use custom -> select the .wic),
  or Rufus on Windows, or `dd` from WSL.
========================================================
DONE
