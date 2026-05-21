# CyberDeck OS — append this to conf/local.conf (or use `require` directive)
#
# Usage in conf/local.conf:
#   require ${TOPDIR}/../meta-cyberdeck/conf/cyberdeck.inc
#   (and copy this file there, or symlink it)
#
# Layer requirements (bblayers.conf must include):
#   sources/meta-clang   → branch: scarthgap-clang20  (Clang 20 required by Chromium 147)
#   sources/meta-browser → branch: scarthgap
#
# To switch meta-clang:
#   git -C ~/cyberdeck/sources/meta-clang fetch origin
#   git -C ~/cyberdeck/sources/meta-clang checkout scarthgap-clang20
#   bitbake -c cleansstate clang-native chromium-ozone-wayland

# ─── Machine ──────────────────────────────────────────────────────────
MACHINE = "raspberrypi5"
DISTRO  = "cyberdeck-os"

# ─── Image features ───────────────────────────────────────────────────
IMAGE_INSTALL:append = " \
    nodejs nodejs-npm \
    python3 python3-fastapi python3-uvicorn python3-redis python3-pip-native \
    redis \
    sqlite3 \
    openssl curl \
    chromium-ozone-wayland \
    weston weston-init weston-examples \
    avahi-daemon avahi-utils \
    nftables \
    openssh openssh-sftp-server \
    libinput evtest \
    alsa-utils alsa-state \
    plymouth plymouth-systemd-units \
    busybox-syslog \
    util-linux util-linux-blkid util-linux-findmnt util-linux-mount \
    batctl iproute2 dhclient \
    kernel-module-batman-adv \
    cyberdeck \
    cyberdeck-firewall \
    cyberdeck-network \
    cyberdeck-bootlogo \
    cyberdeck-power \
    ethtool \
"

# Pull in tooling but exclude package manager + dev shell on shipped image
IMAGE_FEATURES:append = " ssh-server-openssh allow-empty-password-disabled"
IMAGE_FEATURES:remove = " package-management debug-tweaks splash"

# ─── Read-only root ───────────────────────────────────────────────────
EXTRA_IMAGE_FEATURES += "read-only-rootfs"
IMAGE_FEATURES:append = " read-only-rootfs"

# Writable user data partitions are added in the wks file; see deploy/yocto/cyberdeck.wks

# ─── Kernel — kill Wi-Fi and Bluetooth at compile time ────────────────
# Drop the radio modules entirely so they can't be loaded at runtime.
# These match the upstream Pi 5 defconfig; we mask them out via fragment.
KERNEL_FEATURES:append = " features/cyberdeck/no-radio.scc"

# ─── 7-inch DSI touch + libinput ──────────────────────────────────────
# Pi official 7" touchscreen is detected automatically by the upstream
# dt-overlay (vc4-kms-v3d + vc4-fkms-v3d), but ensure libinput is bound
# in weston.ini and touchscreen evdev rules are present.

# ─── Default hostname template (overridden per node from /data/node.conf) ─
hostname_pn-base-files = "deck-XX"

# Boot splash (Plymouth)
PLYMOUTH_THEME = "cyberdeck"

# ─── Clang 20 toolchain ───────────────────────────────────────────────
# Chromium 147 requires Clang 20+ for its bundled libc++ builtins.
# meta-clang must be on the 'scarthgap-clang20' branch.
TOOLCHAIN = "clang"
CLANGVER  = "20"

# ─── Reproducibility / SBOM ──────────────────────────────────────────
INHERIT += "create-spdx"
BB_REPRODUCIBLE_BUILD = "1"
SOURCE_DATE_EPOCH = "1716000000"

# ─── Disk Space Optimization ──────────────────────────────────────────
# Automatically delete temporary working files after each recipe builds.
# This prevents the build folder from growing to 100GB+ and keeps the C drive free.
INHERIT += "rm_work"
