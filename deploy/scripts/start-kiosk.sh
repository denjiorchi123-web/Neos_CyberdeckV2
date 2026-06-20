#!/bin/sh
set -eu

BASE_URL="http://127.0.0.1:3000"
export XDG_SESSION_TYPE=wayland
export GDK_BACKEND=wayland
export WEBKIT_DISABLE_COMPOSITING_MODE=0
export WEBKIT_FORCE_COMPOSITING_MODE=1
export GDK_CORE_DEVICE_EVENTS=1

# Wait for Next.js to start
while ! curl -k -s -o /dev/null "$BASE_URL"; do
  sleep 1
done

# Launch the compiled Tauri Native Executable
exec /opt/cyberdeck/src-tauri/target/release/cyberdeck

