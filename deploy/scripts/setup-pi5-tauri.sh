#!/bin/bash
set -eu

# Script to configure the Raspberry Pi 5, remove old kiosk/GPU configurations,
# install compilation dependencies, compile the Tauri wrapper, and create the desktop shortcut.

show_banner() {
    echo "=========================================================="
    echo "       CYBERDECK / TAURI RASPBERRY PI 5 SETUP SCRIPT      "
    echo "=========================================================="
}

enable_wifi() {
    echo ""
    echo "[1] Enabling Wifi & Bluetooth Radios..."
    
    # 1. Unmask services
    sudo systemctl unmask wpa_supplicant.service bluetooth.service hciuart.service 2>/dev/null || true
    sudo systemctl enable wpa_supplicant.service 2>/dev/null || true
    sudo systemctl start wpa_supplicant.service 2>/dev/null || true

    # 2. Edit boot config to comment out disable-wifi and disable-bt overlays
    BOOT_CONFIG="/boot/firmware/config.txt"
    if [ ! -f "$BOOT_CONFIG" ]; then
        BOOT_CONFIG="/boot/config.txt"
    fi

    if [ -f "$BOOT_CONFIG" ]; then
        echo "Updating overlays in $BOOT_CONFIG..."
        sudo sed -i 's/^dtoverlay=disable-wifi/#dtoverlay=disable-wifi/' "$BOOT_CONFIG"
        sudo sed -i 's/^dtoverlay=disable-bt/#dtoverlay=disable-bt/' "$BOOT_CONFIG"
    fi

    # 3. Unblock via rfkill
    sudo rfkill unblock wifi 2>/dev/null || true
    sudo rfkill unblock bluetooth 2>/dev/null || true
    sudo rfkill unblock all 2>/dev/null || true

    echo "Wifi & Bluetooth enabled! Please connect to Wifi using nmcli if needed."
}

remove_startup_and_gpu() {
    echo ""
    echo "[2] Removing Old Startup Services & GPU Driver Overlays..."
    
    # 1. Disable and stop old services
    sudo systemctl disable --now cyberdeck-kiosk.service 2>/dev/null || true
    sudo systemctl disable --now cyberdeck-web.service 2>/dev/null || true
    sudo systemctl disable --now cyberdeck.service 2>/dev/null || true
    sudo systemctl disable --now redis-cyberdeck.service 2>/dev/null || true

    sudo rm -f /etc/systemd/system/cyberdeck-kiosk.service
    sudo rm -f /etc/systemd/system/cyberdeck-web.service
    sudo rm -f /etc/systemd/system/cyberdeck.service
    sudo rm -f /etc/systemd/system/redis-cyberdeck.service
    sudo systemctl daemon-reload

    # 2. Remove desktop autostart entry
    rm -f ~/.config/autostart/cyberdeck-kiosk.desktop

    # 3. Comment out VC4/V3D GPU Driver overlays
    BOOT_CONFIG="/boot/firmware/config.txt"
    if [ ! -f "$BOOT_CONFIG" ]; then
        BOOT_CONFIG="/boot/config.txt"
    fi

    if [ -f "$BOOT_CONFIG" ]; then
        echo "Commenting out vc4-kms-v3d overlays in $BOOT_CONFIG..."
        sudo sed -i 's/^dtoverlay=vc4-kms-v3d/#dtoverlay=vc4-kms-v3d/' "$BOOT_CONFIG"
        sudo sed -i 's/^dtoverlay=vc4-fkms-v3d/#dtoverlay=vc4-fkms-v3d/' "$BOOT_CONFIG"
    fi

    echo "Startup services and GPU drivers overlay disabled/removed."
}

update_packages() {
    echo ""
    echo "[3] Updating System Packages..."
    sudo apt update
    sudo apt upgrade -y
}

install_tauri_deps() {
    echo ""
    echo "[4] Installing Tauri Compilation Dependencies..."
    sudo apt update
    sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libsoup2.4-dev

    echo "Installing Rust Toolchain..."
    if ! command -v cargo &> /dev/null; then
        curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    else
        echo "Rust is already installed."
    fi
}

compile_tauri() {
    echo ""
    echo "[5] Compiling Tauri Application..."
    if [ -f "$HOME/.cargo/env" ]; then
        source "$HOME/.cargo/env"
    fi

    cd /opt/cyberdeck/src-tauri
    cargo build --release
    echo "Tauri compilation finished. Executable is at /opt/cyberdeck/src-tauri/target/release/cyberdeck"
}

setup_shortcut() {
    echo ""
    echo "[6] Setting up Desktop Shortcut and Icon..."
    
    # 1. Copy icon to pixmaps
    sudo cp /opt/cyberdeck/src-tauri/icons/icon.png /usr/share/pixmaps/cyberdeck.png

    # 2. Write new desktop file
    cat > /opt/cyberdeck/CyberDeck.desktop << 'EOF'
[Desktop Entry]
Version=1.0
Name=CyberDeck
Comment=Native Tauri LAN Messenger
Exec=/opt/cyberdeck/src-tauri/target/release/cyberdeck
Icon=/usr/share/pixmaps/cyberdeck.png
Terminal=false
Type=Application
Categories=Network;
EOF

    # 3. Copy to user Desktop
    mkdir -p "$HOME/Desktop"
    cp /opt/cyberdeck/CyberDeck.desktop "$HOME/Desktop/"
    chmod +x "$HOME/Desktop/CyberDeck.desktop"
    gio set "$HOME/Desktop/CyberDeck.desktop" metadata::trusted yes 2>/dev/null || true

    echo "Desktop shortcut created at ~/Desktop/CyberDeck.desktop."
}

# Run menu or steps
show_banner
enable_wifi
remove_startup_and_gpu
update_packages
install_tauri_deps
compile_tauri
setup_shortcut

echo ""
echo "Setup completed successfully! Please reboot your Pi 5 to apply all changes: sudo reboot"
