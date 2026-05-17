#!/bin/sh
# Block until the Next.js server is accepting HTTPS on :3000.
# Used by the kiosk service so Chromium doesn't launch into a connection error.
set -eu

URL="https://127.0.0.1:3000"
TRIES=60   # ~60s max
i=0
while [ "$i" -lt "$TRIES" ]; do
  if curl --silent --insecure --output /dev/null --max-time 1 "$URL"; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[wait-for-web] Timed out waiting for $URL" >&2
exit 1
