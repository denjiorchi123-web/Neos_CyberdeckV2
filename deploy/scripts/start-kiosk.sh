#!/bin/sh
# Launched by weston kiosk-shell [autolaunch] after the compositor is ready.
# Runs as the cyberdeck user inside a live Wayland session — WAYLAND_DISPLAY is
# already exported by weston before this script is called.
set -eu

URL="${CYBERDECK_URL:-https://127.0.0.1:3000/launcher}"
PROFILE_DIR="${HOME}/.cyberdeck-kiosk"
mkdir -p "$PROFILE_DIR"

# Wait for Next.js to be reachable before opening the browser.
# Avoids Chromium showing "ERR_CONNECTION_REFUSED" on a fast boot.
/opt/cyberdeck/deploy/scripts/wait-for-web.sh || true

# Forcefully remove old locks from bad reboots so Chromium doesn't crash on boot
rm -f "$PROFILE_DIR/SingletonLock"

exec /usr/bin/chromium \
  --kiosk "$URL" \
  --force-device-scale-factor=0.75 \
  --password-store=basic \
  --user-data-dir="$PROFILE_DIR" \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  \
  --no-first-run \
  --no-default-browser-check \
  --disable-translate \
  --disable-features=TranslateUI,Translate \
  --disable-pinch \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --noerrdialogs \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --ignore-certificate-errors \
  --unsafely-treat-insecure-origin-as-secure="$URL" \
  \
  --touch-events=enabled \
  --enable-multitouch \
  \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --gpu-sandbox-failures-fatal=no
