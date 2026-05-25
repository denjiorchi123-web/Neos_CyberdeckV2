#!/bin/bash
# Append Pi Touch Display 2 kernel config + config.txt overlay.
# Idempotent: skips if TOUCHSCREEN_GOODIX is already in the file.
set -euo pipefail

META="${META:-$HOME/cyberdeck/sources/meta-cyberdeck}"
APPEND_FILE="$META/recipes-kernel/linux/files/cyberdeck-hardening.cfg"

if grep -q "TOUCHSCREEN_GOODIX" "$APPEND_FILE"; then
  echo "[skip] Touch Display 2 kernel config already present"
else
  cat >> "$APPEND_FILE" <<'EOF'

# Pi 7-inch Touch Display 2 (DSI, Goodix GT9xx touch, ILI9881C panel)
# Reference: https://www.raspberrypi.com/documentation/accessories/touch-display-2.html
CONFIG_INPUT_TOUCHSCREEN=y
CONFIG_TOUCHSCREEN_GOODIX=y
CONFIG_TOUCHSCREEN_GOODIX_BERLIN_I2C=y
CONFIG_TOUCHSCREEN_EDT_FT5X06=y
CONFIG_TOUCHSCREEN_FT5X06=y
CONFIG_TOUCHSCREEN_RASPBERRYPI_FW=y
CONFIG_DRM_PANEL_RASPBERRYPI_TOUCHSCREEN=y
CONFIG_DRM_PANEL_ILITEK_ILI9881C=y
CONFIG_DRM_PANEL_RASPBERRYPI_DSI=y
CONFIG_DRM_PANEL_BRIDGE=y
CONFIG_DRM_VC4=y
CONFIG_I2C_BCM2835=y
CONFIG_I2C_MUX_PINCTRL=y
CONFIG_HID_MULTITOUCH=y
EOF
  echo "[ok] appended Touch Display 2 + Goodix touch kernel config"
fi

# Also drop a rpi-config bbappend so the DT overlay loads in config.txt
RPI_DIR="$META/recipes-bsp/bootfiles"
mkdir -p "$RPI_DIR"
cat > "$RPI_DIR/rpi-config_git.bbappend" <<'EOF'
# CyberDeck — append Touch Display 2 + camera overlays to /boot/config.txt
do_deploy:append() {
    cat >> "${DEPLOYDIR}/bootfiles/config.txt" <<'TXT'

# === CyberDeck — Pi Touch Display 2 (DSI 7-inch, Goodix touch) ===
dtoverlay=vc4-kms-v3d
dtoverlay=vc4-kms-dsi-ili9881-7inch
max_framebuffers=2

# Goodix GT9xx multitouch over I2C
dtparam=i2c_arm=on
dtparam=i2c1=on

# Camera (Pi Camera Module 3 or USB)
camera_auto_detect=1

# Audio
dtparam=audio=on

# Boot splash (firmware-rendered static)
disable_splash=0
boot_delay=0

# Disable Wi-Fi + Bluetooth at firmware level (kernel also disables; belt+braces)
dtoverlay=disable-wifi
dtoverlay=disable-bt
TXT
}
EOF
echo "[ok] dropped rpi-config_git.bbappend for Touch Display 2 + camera + audio"

ls -la "$APPEND_FILE" "$RPI_DIR/rpi-config_git.bbappend"
