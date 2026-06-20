#!/bin/bash
set -e

echo "[1/4] Installing System Dependencies (WebKit & GTK)..."
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

echo "[2/4] Installing Rust Toolchain..."
if ! command -v cargo &> /dev/null; then
    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

echo "[3/4] Preparing and Compiling Native Tauri Executable (This will take 10-20 minutes)..."
sudo mv /home/nova/src-tauri /opt/cyberdeck/src-tauri
sudo chown -R nova:nova /opt/cyberdeck/src-tauri
cd /opt/cyberdeck/src-tauri
source $HOME/.cargo/env
cargo build --release

echo "[4/4] Activating Radio Silence Protocol..."
sudo rfkill block all
echo "dtoverlay=disable-wifi" | sudo tee -a /boot/firmware/config.txt
echo "dtoverlay=disable-bt" | sudo tee -a /boot/firmware/config.txt

echo "=============================================="
echo "COMPILATION SUCCESSFUL. RADIO HARDWARE SEVERED."
echo "Please restart the kiosk."
echo "=============================================="

