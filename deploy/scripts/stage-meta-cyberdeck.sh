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
  "$META/recipes-connectivity/batctl" \
  "$META/recipes-browser/chromium" \
  "$META/recipes-graphics/wayland/files"

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
cp "$PROJ/deploy/assets/boot-logos/boot-dark.png"                "$META/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/assets/boot-logos/boot-light.png"               "$META/recipes-cyberdeck/bootlogo/files/"
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
LIC_FILES_CHKSUM = "file://README.rst;beginline=4;endline=8;md5=a59e6a3d4a29ef3b0f975b36d4897cc6"

DEPENDS = "libnl pkgconfig-native"
RDEPENDS:${PN} = "kernel-module-batman-adv"

SRC_URI = "https://downloads.open-mesh.org/batman/releases/batman-adv-${PV}/batctl-${PV}.tar.gz"
SRC_URI[sha256sum] = "e42bdf1a4ecb4b188bcd3aca17e120496a42b6547593b917e3ffcf943e3f2913"

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

# 7. Chromium 147 Clang 18 compatibility bbappend (with inline python patches)
# Fixes: __builtin_ctzg, __builtin_clzg, __is_nothrow_convertible,
#        __reference_converts_from_temporary (all Clang 20 builtins)
# Works with the default Clang 18.1.8 from meta-clang/scarthgap branch.
cp "$PROJ/deploy/yocto/snippets/chromium-ozone-wayland_147.0.7727.116.bbappend" \
   "$META/recipes-browser/chromium/"
echo "[ok] dropped chromium-ozone-wayland bbappend (patches will be applied inline during do_patch)"

# 8. weston-init bbappend
cp "$PROJ/deploy/yocto/snippets/weston-init_%.bbappend" "$META/recipes-graphics/wayland/"
cp "$PROJ/deploy/yocto/snippets/weston.ini"             "$META/recipes-graphics/wayland/files/"
echo "[ok] dropped weston-init bbappend"

echo ""
echo "All files staged. Now update the image to install these."
echo ""
echo "REMINDER: Ensure meta-clang is on the scarthgap-clang20 branch:"
echo "  git -C \${HOME}/cyberdeck/sources/meta-clang checkout scarthgap-clang20"
echo ""
ls -la "$META/recipes-cyberdeck/"*/ "$META/recipes-connectivity/batctl/" "$META/recipes-browser/chromium/"
