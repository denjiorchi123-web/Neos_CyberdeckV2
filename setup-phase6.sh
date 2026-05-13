#!/bin/bash
set -e

source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build

bitbake-layers add-layer ~/cyberdeck/sources/meta-openembedded/meta-oe
bitbake-layers add-layer ~/cyberdeck/sources/meta-openembedded/meta-python
bitbake-layers add-layer ~/cyberdeck/sources/meta-openembedded/meta-networking
bitbake-layers add-layer ~/cyberdeck/sources/meta-openembedded/meta-filesystems
bitbake-layers add-layer ~/cyberdeck/sources/meta-raspberrypi
bitbake-layers add-layer ~/cyberdeck/sources/meta-security
bitbake-layers add-layer ~/cyberdeck/sources/meta-virtualization
bitbake-layers add-layer ~/cyberdeck/sources/meta-cyberdeck

cat > ~/cyberdeck/build/conf/local.conf << 'EOF'
MACHINE = "cyberdeck-pi5"
DISTRO = "cyberdeck"
BB_NUMBER_THREADS = "8"
PARALLEL_MAKE = "-j8"
DL_DIR = "${HOME}/cyberdeck/downloads"
SSTATE_DIR = "${HOME}/cyberdeck/sstate-cache"
TMPDIR = "${HOME}/cyberdeck/tmp"
IMAGE_FSTYPES = "wic wic.bz2 rpi-sdimg"
LICENSE_FLAGS_ACCEPTED = "commercial synaptics-killswitch"
DISTRO_FEATURES:append = " wayland opengl virtualization pam"
DISTRO_FEATURES:remove = "x11 selinux bluetooth"
EXTRA_IMAGE_FEATURES += "debug-tweaks ssh-server-openssh"
USER_CLASSES ?= "buildstats"
PATCHRESOLVE = "noop"
BB_DISKMON_DIRS ??= "\
    STOPTASKS,${TMPDIR},1G,100K \
    HALT,${TMPDIR},100M,1K \
    STOPTASKS,${DL_DIR},1G,100K \
    HALT,${DL_DIR},100M,1K \
    STOPTASKS,${SSTATE_DIR},1G,100K \
    HALT,${SSTATE_DIR},100M,1K \
    STOPTASKS,/tmp,100M,100K \
    HALT,/tmp,10M,1K"
BB_HASHSERVE_UPSTREAM = "wss://hashserv.yoctoproject.org/ws"
SSTATE_MIRRORS = "file://.* https://cdn.jsdelivr.net/yocto/sstate/all/PATH;downloadfilename=PATH"
BB_SIGNATURE_HANDLER = "OEEquivHash"
BB_HASHSERVE = "auto"
CONF_VERSION = "2"
EOF

echo "=== Phase 6 done ==="
echo "--- Layers ---"
bitbake-layers show-layers
echo "--- local.conf first 5 lines ---"
head -5 ~/cyberdeck/build/conf/local.conf
