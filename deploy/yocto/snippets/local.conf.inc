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
DISTRO  = "cyberdeck"

# Redundant IMAGE_INSTALL:append removed as all packages are cleanly defined in cyberdeck-image.bb

# Pull in tooling but exclude package manager + dev shell on shipped image
IMAGE_FEATURES:append = " ssh-server-openssh"
IMAGE_FEATURES:remove = " package-management debug-tweaks splash"

# ─── Console Login & User Configuration ───────────────────────────────
# Since debug-tweaks is removed, we must explicitly define passwords.
INHERIT += "extrausers"
EXTRA_USERS_PARAMS = " \
    usermod -p '\$6\$rounds=5000\$saltstringsaltst\$7743.hQe5GvK7N8pW32B/pE7w.36hJ53c9e.D74B/b1w8P/yN6z5g/7' root; \
    groupadd -g 1001 cyberdeck; \
    useradd -m -p '\$6\$rounds=5000\$saltstringsaltst\$7743.hQe5GvK7N8pW32B/pE7w.36hJ53c9e.D74B/b1w8P/yN6z5g/7' -s /bin/sh -g cyberdeck -u 1001 cyberdeck; \
    usermod -aG video,audio,input,render cyberdeck; \
    useradd -m -p '\$6\$rounds=5000\$saltstringsaltst\$7743.hQe5GvK7N8pW32B/pE7w.36hJ53c9e.D74B/b1w8P/yN6z5g/7' -s /bin/sh deck; \
"

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
# TOOLCHAIN = "clang"
# CLANGVER  = "20"

# ─── Reproducibility / SBOM ──────────────────────────────────────────
INHERIT += "create-spdx"
BB_REPRODUCIBLE_BUILD = "1"
SOURCE_DATE_EPOCH = "1716000000"

# ─── Disk Space Optimization ──────────────────────────────────────────
# Automatically delete temporary working files after each recipe builds.
# This prevents the build folder from growing to 100GB+ and keeps the C drive free.
INHERIT += "rm_work"
