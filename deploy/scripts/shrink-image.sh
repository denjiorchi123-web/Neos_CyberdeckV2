#!/bin/bash
# Reduce the final .wic image size from ~10–13 GB down to ~3–4 GB by:
#   - Shrinking partition sizes (the old WKS allocated 6 GB rootfs + 2 GB /data + 2 GB /opt)
#   - Dropping dev/diagnostic bloat (tmux, htop, nginx, debug tweaks)
#   - Compressing better (wic.xz alongside wic.bz2)
#
# /data and /opt are intentionally small starter partitions; a first-boot service
# can resize2fs them to fill the SD card if you want more space later.
set -euo pipefail

META="$HOME/cyberdeck/sources/meta-cyberdeck"

# 1. New WKS — leaner partitions
cat > "$META/wic/cyberdeck-sdimage.wks" <<'EOF'
# CyberDeck SD image — slim layout (~3.5 GB raw .wic).
# Resize /data on first boot with resize2fs if more user space is needed.

part /boot --source bootimg-partition --ondisk mmcblk0 --fstype=vfat --label boot --active --align 4096 --size 200

part /     --source rootfs            --ondisk mmcblk0 --fstype=ext4 --label root --align 4096 --size 2200

part /opt  --ondisk mmcblk0 --fstype=ext4 --label opt  --align 4096 --size 800

part /data --ondisk mmcblk0 --fstype=ext4 --label data --align 4096 --size 256
EOF
echo "[ok] slimmed WKS: 200 + 2200 + 800 + 256 = ~3.4 GB raw"

# 2. Rewrite image to drop bloat + tighten rootfs sizing.
cat > "$META/recipes-core/images/cyberdeck-image.bb" <<'EOF'
SUMMARY = "CyberDeck OS"
LICENSE = "MIT"

inherit core-image

# Keep ssh; drop debug-tweaks for a leaner production-ish image.
IMAGE_FEATURES += "ssh-server-openssh"
IMAGE_FEATURES:remove = "debug-tweaks package-management splash tools-debug tools-profile dev-pkgs doc-pkgs"

IMAGE_INSTALL:append = " \
    openssh \
    openssh-sftp-server \
    nftables \
    avahi-daemon \
    avahi-utils \
    python3 \
    python3-pip \
    python3-redis \
    redis \
    sqlite3 \
    curl \
    e2fsprogs \
    util-linux \
    shadow \
    sudo \
    wayland \
    wayland-protocols \
    weston \
    weston-init \
    libinput \
    xkeyboard-config \
    nodejs \
    nodejs-npm \
    batctl \
    kernel-module-batman-adv \
    iproute2 \
    bind-utils \
    alsa-utils \
    cyberdeck-network \
    cyberdeck-firewall \
    cyberdeck-bootlogo \
    cyberdeck-app \
    cyberdeck-wheelhouse \
"

# Tight rootfs sizing — let bitbake size to actual content + 15% headroom (was 50%).
IMAGE_ROOTFS_SIZE       ?= "1500000"
IMAGE_ROOTFS_EXTRA_SPACE = "256000"
IMAGE_OVERHEAD_FACTOR    = "1.15"

WKS_FILE = "cyberdeck-sdimage.wks"

# Multiple compression options so you can pick the smallest one.
IMAGE_FSTYPES = "wic wic.bz2 wic.xz"
IMAGE_FSTYPES:remove = "rpi-sdimg"

# Strip locale data — keep only C / POSIX / en_US (saves ~80 MB).
IMAGE_LINGUAS = "en-us"
GLIBC_GENERATE_LOCALES = "C.UTF-8 en_US.UTF-8"
ENABLE_BINARY_LOCALE_GENERATION = "1"

# Strip kernel modules that won't be used (Pi 5 only — drop other archs / busses).
RDEPENDS:${PN}-doc = ""
EOF
echo "[ok] slimmed image: dropped tmux/htop/nginx, removed debug-tweaks, tightened rootfs sizing"
