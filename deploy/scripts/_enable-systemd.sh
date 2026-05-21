#!/bin/bash
# One-shot fix: enable systemd in the live local.conf.
set -euo pipefail
CONF=/home/nova/cyberdeck/build/conf/local.conf
cp -n "$CONF" "$CONF.pre-systemd.bak" || true

# Ensure systemd is in DISTRO_FEATURES:append
if ! grep -E '^DISTRO_FEATURES:append.*\bsystemd\b' "$CONF" >/dev/null; then
    sed -i 's/^DISTRO_FEATURES:append = " /DISTRO_FEATURES:append = " systemd /' "$CONF"
fi

# Set INIT_MANAGER if not already set
if ! grep -E '^INIT_MANAGER' "$CONF" >/dev/null; then
    {
        echo ""
        echo "# Use systemd as the init manager (needed for cyberdeck-* services + networkd)"
        echo 'INIT_MANAGER = "systemd"'
    } >> "$CONF"
fi

echo "--- after ---"
grep -E 'DISTRO_FEATURES|INIT_MANAGER' "$CONF"
