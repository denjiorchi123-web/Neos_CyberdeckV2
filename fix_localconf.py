#!/usr/bin/env python3
import os

content = r'''MACHINE = "cyberdeck-pi5"
DISTRO = "cyberdeck"

# Reduced from 8 to 6 — prevents fakeroot broken pipe on WSL2
BB_NUMBER_THREADS = "6"
PARALLEL_MAKE = "-j6"

DL_DIR = "${HOME}/cyberdeck/downloads"
SSTATE_DIR = "${HOME}/cyberdeck/sstate-cache"
TMPDIR = "${HOME}/cyberdeck/tmp"

IMAGE_FSTYPES = "wic wic.bz2 rpi-sdimg"
LICENSE_FLAGS_ACCEPTED = "commercial synaptics-killswitch"

DISTRO_FEATURES:append = " wayland opengl virtualization pam security"
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

# Airgapped build — no hashserve, no sstate mirrors
BB_HASHSERVE = ""
BB_HASHSERVE_UPSTREAM = ""
BB_SIGNATURE_HANDLER = "OEBasicHash"
SSTATE_MIRRORS = ""

PACKAGE_CLASSES = "package_ipk"
CONF_VERSION = "2"
'''

path = os.path.expanduser("~/cyberdeck/build/conf/local.conf")
with open(path, 'w') as f:
    f.write(content)
print(f"Written {len(content)} bytes to {path}")
