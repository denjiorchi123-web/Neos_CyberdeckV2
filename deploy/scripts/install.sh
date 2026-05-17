#!/bin/sh
# One-shot installer for a built CyberDeck image onto a running Linux box.
# On Yocto this work happens in the recipe (see deploy/yocto/cyberdeck.bb stub);
# this script is for manual installs on Raspberry Pi OS or hand-rolled images.
set -eu

SRC="${1:-/opt/cyberdeck-staging}"
DEST="/opt/cyberdeck"

echo "[install] Copying $SRC -> $DEST"
mkdir -p "$DEST"
cp -a "$SRC/." "$DEST/"

echo "[install] Creating cyberdeck user"
id -u cyberdeck >/dev/null 2>&1 || useradd --create-home --shell /bin/sh --uid 1000 cyberdeck
usermod -aG video,audio,input,render,seat,i2c cyberdeck

echo "[install] Setting ownership"
chown -R cyberdeck:cyberdeck "$DEST"
chmod +x "$DEST/deploy/scripts/"*.sh

echo "[install] Installing privileged helpers"
install -m 0755 "$DEST/deploy/scripts/cyberdeck-netconfig.sh" /usr/local/bin/cyberdeck-netconfig.sh
install -m 0755 "$DEST/deploy/scripts/usb-mount.sh"  /usr/local/bin/usb-mount.sh
install -m 0755 "$DEST/deploy/scripts/usb-umount.sh" /usr/local/bin/usb-umount.sh
install -d /etc/sudoers.d
install -m 0440 "$DEST/deploy/sudo/99-cyberdeck" /etc/sudoers.d/99-cyberdeck

echo "[install] Installing udev rules"
install -m 0644 "$DEST/deploy/udev/99-cyberdeck-input.rules" /etc/udev/rules.d/
install -m 0644 "$DEST/deploy/udev/98-usb-automount.rules"   /etc/udev/rules.d/

echo "[install] Installing systemd units"
install -m 644 "$DEST/deploy/systemd/"*.service /etc/systemd/system/
install -d /etc/systemd/system/getty@tty1.service.d
install -m 644 "$DEST/deploy/systemd/getty@tty1.service.d/autologin.conf" \
    /etc/systemd/system/getty@tty1.service.d/autologin.conf

echo "[install] Installing avahi service for peer discovery"
install -D -m 644 "$DEST/deploy/avahi/cyberdeck.service" /etc/avahi/services/cyberdeck.service

# Seed peers.json from the example if one isn't already present.
if [ ! -f "$DEST/peers.json" ] && [ -f "$DEST/config/peers.json.example" ]; then
  echo "[install] Seeding peers.json from example (edit /opt/cyberdeck/peers.json to customize)"
  install -m 644 "$DEST/config/peers.json.example" "$DEST/peers.json"
  chown cyberdeck:cyberdeck "$DEST/peers.json"
fi

systemctl daemon-reload
systemctl enable redis-cyberdeck cyberdeck-backend cyberdeck-web cyberdeck-kiosk
systemctl enable avahi-daemon 2>/dev/null || true
udevadm control --reload-rules 2>/dev/null || true
systemctl set-default graphical.target

echo "[install] Done. Reboot to launch the kiosk."
