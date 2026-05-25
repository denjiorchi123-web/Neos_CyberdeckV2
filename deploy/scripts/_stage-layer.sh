#!/bin/bash
# Copies all updated CyberDeck recipe files into the meta-cyberdeck layer.
# Called from Windows via: wsl bash /mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/scripts/_stage-layer.sh
set -euo pipefail

PROJ="${PROJ:-/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS}"
YOCTO_ROOT="${YOCTO_ROOT:-$HOME/cyberdeck}"
LAYER="$YOCTO_ROOT/sources/meta-cyberdeck"
APPFILES="$LAYER/recipes-cyberdeck/cyberdeck-app/files"

echo "[1] Copying app systemd units into app recipe files..."
cp "$PROJ/deploy/systemd/cyberdeck-power.service" "$APPFILES/cyberdeck-power.service"
cp "$PROJ/deploy/systemd/cyberdeck-kiosk.service" "$APPFILES/cyberdeck-kiosk.service"

echo "[1b] Installing patched cyberdeck-app recipe (adds kiosk service + weston.ini)..."
cp "$PROJ/deploy/yocto/snippets/cyberdeck-app.bb" "$LAYER/recipes-cyberdeck/cyberdeck-app/cyberdeck-app.bb"

echo "[1c] Wiring kiosk + plymouth into the image recipe..."
IMG="$LAYER/recipes-core/images/cyberdeck-image.bb"
if ! grep -q 'chromium-ozone-wayland' "$IMG"; then
    cat "$PROJ/deploy/yocto/snippets/cyberdeck-image.append" >> "$IMG"
    echo "      appended kiosk + plymouth block"
else
    echo "      already wired — skipping"
fi

echo "[2] Creating power recipe..."
mkdir -p "$LAYER/recipes-cyberdeck/power/files"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-power.bb" "$LAYER/recipes-cyberdeck/power/cyberdeck-power.bb"
cp "$PROJ/deploy/systemd/cyberdeck-power.service"   "$LAYER/recipes-cyberdeck/power/files/cyberdeck-power.service"

echo "[3] Updating network recipe files..."
cp "$PROJ/deploy/yocto/snippets/cyberdeck-network.bb"              "$LAYER/recipes-cyberdeck/network/cyberdeck-network.bb"
cp "$PROJ/deploy/yocto/snippets/05-bat0.netdev"                    "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/10-eth0-static.network"            "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/15-bat0.network"                   "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/20-usb0-gadget.network"            "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/batman-adv-modload.conf"           "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-identity.sh"             "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-identity.service"        "$LAYER/recipes-cyberdeck/network/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck-batadv-tune.service"     "$LAYER/recipes-cyberdeck/network/files/"

echo "[4] Updating firewall recipe files..."
cp "$PROJ/deploy/yocto/snippets/cyberdeck-firewall.bb" "$LAYER/recipes-cyberdeck/firewall/cyberdeck-firewall.bb"
cp "$PROJ/deploy/yocto/snippets/cyberdeck.nft"         "$LAYER/recipes-cyberdeck/firewall/files/"
cp "$PROJ/deploy/yocto/snippets/nftables.service"      "$LAYER/recipes-cyberdeck/firewall/files/"

cp "$PROJ/deploy/yocto/snippets/cyberdeck-bootlogo.bb" "$LAYER/recipes-cyberdeck/bootlogo/cyberdeck-bootlogo.bb"
cp "$PROJ/deploy/yocto/snippets/cyberdeck.plymouth"    "$LAYER/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/yocto/snippets/cyberdeck.script"      "$LAYER/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/assets/boot-logos/boot-dark.png"      "$LAYER/recipes-cyberdeck/bootlogo/files/"
cp "$PROJ/deploy/assets/boot-logos/boot-light.png"     "$LAYER/recipes-cyberdeck/bootlogo/files/"

echo "[6] (skipped) deploy/yocto/cyberdeck.bb is a documentation stub — the"
echo "    real recipe is cyberdeck-app.bb, already staged in step [1b]."
echo "    Removing any leftover stub to avoid PROVIDES conflict..."
rm -rf "$LAYER/recipes-cyberdeck/cyberdeck"

echo "[7] Updating layer conf include (local.conf.inc -> conf/cyberdeck.inc)..."
mkdir -p "$LAYER/conf"
cp "$PROJ/deploy/yocto/snippets/local.conf.inc" "$LAYER/conf/cyberdeck.inc"

echo "[8] Updating wks image layout..."
mkdir -p "$LAYER/wic"
cp "$PROJ/deploy/yocto/cyberdeck.wks" "$LAYER/wic/cyberdeck.wks"

echo "[9] Verifying staged services..."
find "$LAYER/recipes-cyberdeck" -name '*.service' | sort

echo ""
echo "All recipe files staged successfully."
