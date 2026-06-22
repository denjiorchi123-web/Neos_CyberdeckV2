#!/bin/bash
set -eu

# Unified Single Setup Script for Raspberry Pi 5
# Configures WiFi/Bluetooth, removes old startup/GPU configs, updates system,
# sets up the Next.js database and backend services, installs compilation tools,
# builds the Tauri native app, and configures the desktop shortcut.

PROJECT_DIR="/opt/cyberdeck"

# Ensure the compiling user owns the directory at the start of the script to prevent EACCES errors
sudo chown -R $USER:$USER "$PROJECT_DIR"

echo "=========================================================="
echo "    STARTING NATIVE TAURI & SYSTEM CONFIGURATION SCRIPT   "
echo "=========================================================="

# 1. Enable Wifi & Bluetooth Radios
echo -e "\n[1/8] Enabling Wifi & Bluetooth Radios..."
sudo systemctl unmask wpa_supplicant.service bluetooth.service hciuart.service 2>/dev/null || true
sudo systemctl enable wpa_supplicant.service 2>/dev/null || true
sudo systemctl start wpa_supplicant.service 2>/dev/null || true

BOOT_CONFIG="/boot/firmware/config.txt"
if [ ! -f "$BOOT_CONFIG" ]; then
    BOOT_CONFIG="/boot/config.txt"
fi

if [ -f "$BOOT_CONFIG" ]; then
    echo "Restoring WiFi and Bluetooth in boot config: $BOOT_CONFIG"
    sudo sed -i 's/^dtoverlay=disable-wifi/#dtoverlay=disable-wifi/' "$BOOT_CONFIG"
    sudo sed -i 's/^dtoverlay=disable-bt/#dtoverlay=disable-bt/' "$BOOT_CONFIG"
fi

sudo rfkill unblock wifi 2>/dev/null || true
sudo rfkill unblock bluetooth 2>/dev/null || true
sudo rfkill unblock all 2>/dev/null || true
echo "WiFi and Bluetooth services successfully unmasked and enabled."

# 2. Disable Old Startup Kiosk & GPU Overlay Driver
echo -e "\n[2/8] Disabling Old Startup Services & commenting out VC4 GPU Overlays..."
# Stop and disable systemd kiosk/web services
sudo systemctl disable --now cyberdeck-kiosk.service 2>/dev/null || true
sudo systemctl disable --now cyberdeck-web.service 2>/dev/null || true
sudo systemctl disable --now cyberdeck.service 2>/dev/null || true
sudo systemctl disable --now redis-cyberdeck.service 2>/dev/null || true

sudo rm -f /etc/systemd/system/cyberdeck-kiosk.service
sudo rm -f /etc/systemd/system/cyberdeck-web.service
sudo rm -f /etc/systemd/system/cyberdeck.service
sudo rm -f /etc/systemd/system/redis-cyberdeck.service
sudo systemctl daemon-reload

# Remove user GUI autostart files
rm -f ~/.config/autostart/cyberdeck-kiosk.desktop
rm -f ~/.config/autostart/cyberdeck*.desktop

# Comment out vc4 GPU drivers in config.txt to fall back to generic framebuffer
if [ -f "$BOOT_CONFIG" ]; then
    echo "Commenting out vc4-kms-v3d / vc4-fkms-v3d in $BOOT_CONFIG"
    sudo sed -i 's/^dtoverlay=vc4-kms-v3d/#dtoverlay=vc4-kms-v3d/' "$BOOT_CONFIG"
    sudo sed -i 's/^dtoverlay=vc4-fkms-v3d/#dtoverlay=vc4-fkms-v3d/' "$BOOT_CONFIG"
fi
echo "Old kiosk services and GPU drivers overlay disabled/removed."

# 3. Update System Packages
echo -e "\n[3/8] Updating System Packages (safely without removing any packages)..."
sudo apt update
sudo apt upgrade -y

# 4. Install Next.js Backend & DB Dependencies
echo -e "\n[4/8] Installing Node.js dependencies & configuring Prisma Database..."
cd "$PROJECT_DIR"

# Generate .env file if it does not exist
if [ ! -f .env ]; then
    echo "Creating .env configuration..."
    cat > .env << 'EOF'
DATABASE_URL="file:./prisma/dev.db?journal_mode=WAL"
REDIS_URL=redis://127.0.0.1:6379
NEXT_PUBLIC_SITE_URL=https://localhost:3000
CYBERDECK_HOME=/opt/cyberdeck
MESH_SECRET=change-this-shared-lan-secret-on-all-pis
EOF
fi

npm install --include=optional --no-audit --no-fund
npx prisma generate
npm run db:push
npm run build

# 5. Set up Background Services (Redis & Next.js backend)
echo -e "\n[5/8] Creating background system services for database, Next.js, and Redis..."
# Install and run Redis Service
sudo cp "$PROJECT_DIR/deploy/systemd/redis-cyberdeck.service" /etc/systemd/system/redis-cyberdeck.service
sudo systemctl daemon-reload
sudo systemctl enable redis-cyberdeck.service
sudo systemctl restart redis-cyberdeck.service || true

# Create cyberdeck system user if not exists
sudo useradd --system --create-home --home /home/cyberdeck --shell /usr/sbin/nologin cyberdeck 2>/dev/null || true
sudo usermod -a -G cyberdeck $USER 2>/dev/null || true

# Set up runtime write access for the cyberdeck daemon user
sudo mkdir -p "$PROJECT_DIR/prisma" "$PROJECT_DIR/public"
sudo chown -R cyberdeck:cyberdeck "$PROJECT_DIR/prisma" "$PROJECT_DIR/public"
sudo chmod -R 775 "$PROJECT_DIR/prisma" "$PROJECT_DIR/public"
if [ -f "$PROJECT_DIR/prisma/dev.db" ]; then
    sudo chmod 664 "$PROJECT_DIR/prisma/dev.db"
fi

# Install and run Next.js Web Server Service
sudo cp "$PROJECT_DIR/deploy/systemd/cyberdeck-web.service" /etc/systemd/system/cyberdeck-web.service
sudo systemctl daemon-reload
sudo systemctl enable cyberdeck-web.service
sudo systemctl restart cyberdeck-web.service || true

# 6. Install Tauri Development Dependencies & Rust
echo -e "\n[6/8] Installing Tauri dependencies & Rust Toolchain..."
sudo apt install -y libwebkit2gtk-4.1-dev libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libsoup2.4-dev

if ! command -v cargo &> /dev/null; then
    echo "Installing Rust compiler..."
    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

# 7. Compile Native Tauri Executable
echo -e "\n[7/8] Compiling Tauri Desktop Application (This will take 10-20 minutes)..."
# Load Rust environment
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

cd "$PROJECT_DIR/src-tauri"
cargo build --release
echo "Tauri compilation finished successfully!"

# 8. Configure Desktop Shortcut & Icon
echo -e "\n[8/8] Configuring Desktop Shortcut and Icon..."
# Copy icon to pixmaps
sudo cp "$PROJECT_DIR/src-tauri/icons/icon.png" /usr/share/pixmaps/cyberdeck.png

# Create the desktop configuration file
cat > "$PROJECT_DIR/CyberDeck.desktop" << 'EOF'
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

# Copy desktop entry to user Desktop and make executable
mkdir -p "$HOME/Desktop"
cp "$PROJECT_DIR/CyberDeck.desktop" "$HOME/Desktop/"
chmod +x "$HOME/Desktop/CyberDeck.desktop"
gio set "$HOME/Desktop/CyberDeck.desktop" metadata::trusted yes 2>/dev/null || true

echo "=========================================================="
echo " SETUP COMPLETED SUCCESSFULLY!                            "
echo " Please reboot the Raspberry Pi to apply all changes:     "
echo "                                                          "
echo "                   sudo reboot                            "
echo "=========================================================="
