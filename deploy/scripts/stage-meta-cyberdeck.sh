#!/bin/bash
# Stage all meta-cyberdeck files from this repo into the user's WSL Yocto layer.
# Run from WSL Ubuntu 24.04:  bash deploy/scripts/stage-meta-cyberdeck.sh
set -euo pipefail

META="${META:-$HOME/cyberdeck/sources/meta-cyberdeck}"
PROJ="${PROJ:-/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS}"

if [ ! -d "$META" ]; then
  echo "ERROR: $META does not exist. Set META=/path/to/meta-cyberdeck." >&2
  exit 1
fi

mkdir -p \
  "$META/recipes-cyberdeck/network/files" \
  "$META/recipes-cyberdeck/firewall/files" \
  "$META/recipes-cyberdeck/bootlogo/files" \
  "$META/recipes-cyberdeck/power/files" \
  "$META/recipes-connectivity/batctl"

# 1. Append batman-adv to existing kernel hardening config
APPEND_FILE="$META/recipes-kernel/linux/files/cyberdeck-hardening.cfg"
if [ -f "$APPEND_FILE" ] && ! grep -q "BATMAN_ADV" "$APPEND_FILE"; then
  cat >> "$APPEND_FILE" <<'EOF'

# batman-adv L2 mesh (fiber/copper mesh networking)
CONFIG_BATMAN_ADV=m
CONFIG_BATMAN_ADV_BATMAN_V=y
CONFIG_BATMAN_ADV_BLA=y
CONFIG_BATMAN_ADV_DAT=y
CONFIG_BATMAN_ADV_NC=y
CONFIG_BATMAN_ADV_MCAST=y
CONFIG_CRC16=y
CONFIG_LIBCRC32C=y
EOF
  echo "[ok] appended batman-adv kernel config"
else
  echo "[skip] batman-adv kernel config already present"
fi

# 2. Network recipe
cp "$PROJ/deploy/yocto/snippets/cyberdeck-network.bb"            "$META/recipes-cyberdeck/network/"
cp "$PROJ/deploy/yocto/snippets/05-bat0.netdev"                  "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/10-eth0-static.network"          "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/15-bat0.network"                 "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/20-usb0-gadget.network"          "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/batman-adv-modload.conf"         "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-identity.sh"           "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-identity.service"      "$META/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-batadv-tune.service"   "$META/recipes-cyberdeck/network/files/"
echo "[ok] dropped network recipe"

# 3. Firewall recipe
cp "$PROJ/deploy/yocto/snippets/cyberdeck-firewall.bb"           "$META/recipes-cyberdeck/firewall/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck.nft"                   "$META/recipes-cyberdeck/firewall/files/"
cp "$PROJ/deploy/yocto/snippets/nftables.service"                "$META/recipes-cyberdeck/firewall/files/"
echo "[ok] dropped firewall recipe"

# 4. Bootlogo recipe
cp "$PROJ/deploy/yocto/snippets/cyberdeck-bootlogo.bb"           "$META/recipes-cyberdeck/bootlogo/"
cp "$PROJ/deploy/assets/boot-logos/boot-dark.jpeg"               "$META/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/assets/boot-logos/boot-light.jpeg"              "$META/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck.plymouth"              "$META/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck.script"                "$META/recipes-cyberdeck/bootlogo/files/"
echo "[ok] dropped bootlogo recipe"

# 5. Power recipe — Pi 5 CPU governor + RP1 tuning
cp "$PROJ/deploy/yocto/snippets/cyberdeck-power.bb"  "$META/recipes-cyberdeck/power/"
cp "$PROJ/deploy/systemd/cyberdeck-power.service"    "$META/recipes-cyberdeck/power/files/"
echo "[ok] dropped power recipe"

# 6. batctl recipe — pulls from open-mesh.org
cat > "$META/recipes-connectivity/batctl/batctl_2024.4.bb" <<'EOF'
SUMMARY = "B.A.T.M.A.N. Advanced userspace tool"
HOMEPAGE = "https://www.open-mesh.org/projects/batctl"
LICENSE = "GPL-2.0-only & MIT"
LIC_FILES_CHKSUM = "file://README.rst;beginline=4;endline=8;md5=ddd99d8527e6dd2bb22d8c5d8c25b59f"

DEPENDS = "libnl pkgconfig-native"
RDEPENDS:${PN} = "kernel-module-batman-adv"

SRC_URI = "https://downloads.open-mesh.org/batman/releases/batman-adv-${PV}/batctl-${PV}.tar.gz"
SRC_URI[sha256sum] = "5036c0e1de4f9d75bf07e6e35f53e22e0a3ce6f5ce26ec38d2a8e44b3b0fd1b1"

S = "${WORKDIR}/batctl-${PV}"

EXTRA_OEMAKE = " \
    PREFIX=${prefix} \
    SBINDIR=${sbindir} \
    MANDIR=${mandir} \
    CC='${CC}' \
    AR='${AR}' \
    PKG_CONFIG='${STAGING_BINDIR_NATIVE}/pkg-config' \
"

do_compile() {
    oe_runmake
}

do_install() {
    oe_runmake DESTDIR=${D} install
}

FILES:${PN} = "${sbindir}/batctl"
EOF
echo "[ok] dropped batctl recipe"

echo ""
echo "All files staged. Now update the image to install these."
echo ""
ls -la "$META/recipes-cyberdeck/"*/ "$META/recipes-connectivity/batctl/"
