#!/bin/sh
set -eu

BASE_URL="https://127.0.0.1:3000"
LAUNCHER_PATH="/launcher"
URL="${BASE_URL}${LAUNCHER_PATH}"
PROFILE_DIR="${HOME}/.cyberdeck-kiosk"
mkdir -p "$PROFILE_DIR"
export XDG_SESSION_TYPE=wayland

rm -f "$PROFILE_DIR/SingletonLock"

# Wait for Next.js to start
while ! curl -k -s -o /dev/null "$BASE_URL"; do
  sleep 1
done

exec /usr/bin/chromium \
  --kiosk "$URL" \
  --force-device-scale-factor=0.85 \
  --password-store=basic \
  --user-data-dir="$PROFILE_DIR" \
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
  --unsafely-treat-insecure-origin-as-secure="$BASE_URL" \
  --disable-web-security \
  --allow-insecure-localhost \
  --allow-running-insecure-content \
  --touch-events=enabled \
  --enable-multitouch \
  --no-sandbox \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --gpu-sandbox-failures-fatal=no \
  --disable-vulkan \
  --enable-native-gpu-memory-buffers \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --ignore-gpu-blocklist

