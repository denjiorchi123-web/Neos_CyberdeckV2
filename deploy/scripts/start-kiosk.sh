#!/bin/sh
set -eu

BASE_URL="http://127.0.0.1:3000"
export XDG_SESSION_TYPE=wayland

# Wait for Next.js to start
while ! curl -k -s -o /dev/null "$BASE_URL"; do
  sleep 1
done

# Launch the compiled Tauri Native Executable
exec /opt/cyberdeck/src-tauri/target/release/cyberdeck

