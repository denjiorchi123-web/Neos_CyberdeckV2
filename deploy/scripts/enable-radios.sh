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

echo "[CyberDeck] Unblocking WiFi and Bluetooth with rfkill..."
rfkill unblock wifi 2>/dev/null || true
rfkill unblock bluetooth 2>/dev/null || true

echo "[CyberDeck] Unmasking and enabling WiFi supplicant service..."
systemctl unmask wpa_supplicant.service 2>/dev/null || true
systemctl enable --now wpa_supplicant.service 2>/dev/null || true

if [ -f "$BOOT_CONFIG" ]; then
  echo "[CyberDeck] Commenting out permanent radio disable overlays in $BOOT_CONFIG..."
  sed -i 's/^dtoverlay=disable-wifi/#dtoverlay=disable-wifi/' "$BOOT_CONFIG"
  sed -i 's/^dtoverlay=disable-bt/#dtoverlay=disable-bt/' "$BOOT_CONFIG"
fi

echo "[CyberDeck] Radios re-enabled successfully!"
echo "[CyberDeck] Reboot required to apply kernel configurations: sudo reboot"
