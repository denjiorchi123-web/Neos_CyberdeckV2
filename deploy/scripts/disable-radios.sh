#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

BOOT_CONFIG="/boot/firmware/config.txt"
if [ ! -f "$BOOT_CONFIG" ]; then
  BOOT_CONFIG="/boot/config.txt"
fi

if [ ! -f "$BOOT_CONFIG" ]; then
  echo "Could not find Raspberry Pi boot config at /boot/firmware/config.txt or /boot/config.txt" >&2
  exit 1
fi

echo "[CyberDeck] Blocking WiFi and Bluetooth with rfkill..."
rfkill block wifi 2>/dev/null || true
rfkill block bluetooth 2>/dev/null || true

echo "[CyberDeck] Disabling Bluetooth services..."
systemctl disable --now bluetooth.service 2>/dev/null || true
systemctl mask bluetooth.service 2>/dev/null || true
systemctl disable --now hciuart.service 2>/dev/null || true
systemctl mask hciuart.service 2>/dev/null || true

echo "[CyberDeck] Disabling WiFi supplicant service..."
systemctl disable --now wpa_supplicant.service 2>/dev/null || true
systemctl mask wpa_supplicant.service 2>/dev/null || true

BACKUP="${BOOT_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
cp "$BOOT_CONFIG" "$BACKUP"
echo "[CyberDeck] Backed up boot config to $BACKUP"

grep -q '^dtoverlay=disable-wifi$' "$BOOT_CONFIG" || echo 'dtoverlay=disable-wifi' >> "$BOOT_CONFIG"
grep -q '^dtoverlay=disable-bt$' "$BOOT_CONFIG" || echo 'dtoverlay=disable-bt' >> "$BOOT_CONFIG"

echo "[CyberDeck] Permanent radio disable overlays installed in $BOOT_CONFIG"
echo "[CyberDeck] Reboot required: sudo reboot"
