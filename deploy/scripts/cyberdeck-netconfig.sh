#!/bin/sh
# Privileged helper — configures a network interface as static or DHCP.
# Called by the CyberDeck web app via sudo:
#
#   Static:  sudo cyberdeck-netconfig.sh <iface> <ip> <prefix_len> [gateway]
#   DHCP:    sudo cyberdeck-netconfig.sh <iface> dhcp
#
# Allowed interfaces: bat0, eth0, usb0, eth1, eth2, enp1s0, enp2s0, enp3s0, wlan0
set -eu

IFACE="$1"
MODE="${2:-}"

# Whitelist — never touch loopback or unknown interfaces
case "$IFACE" in
  bat0|eth0|usb0|eth1|eth2|enp1s0|enp2s0|enp3s0|wlan0) ;;
  *) echo "Rejected: interface '$IFACE' not allowed" >&2; exit 1 ;;
esac

NETDIR="/etc/systemd/network"
FILE="$NETDIR/10-${IFACE}-static.network"
mkdir -p "$NETDIR"

# ── DHCP mode ────────────────────────────────────────────────────────────────

if [ "$MODE" = "dhcp" ]; then
  # Write a networkd DHCP config
  cat > "$FILE" << EOF
[Match]
Name=$IFACE

[Network]
DHCP=yes
IPv6AcceptRA=no
EOF

  # Apply immediately
  if systemctl is-active --quiet systemd-networkd 2>/dev/null; then
    networkctl reload 2>/dev/null || systemctl restart systemd-networkd
  else
    # Fallback: kill any existing dhclient and start a new one
    kill "$(cat /var/run/dhclient.${IFACE}.pid 2>/dev/null)" 2>/dev/null || true
    ip addr flush dev "$IFACE" 2>/dev/null || true
    ip link set "$IFACE" up
    dhclient -v "$IFACE" 2>/dev/null || \
      udhcpc -i "$IFACE" -q 2>/dev/null || \
      echo "Warning: no DHCP client found; config written for next boot" >&2
  fi
  echo "DHCP enabled on $IFACE"
  exit 0
fi

# ── Static mode ───────────────────────────────────────────────────────────────

IP="$MODE"   # second arg is the IP when not 'dhcp'
PREFIX="${3:-24}"
GW="${4:-}"

# Basic IP sanity
echo "$IP"     | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || { echo "Bad IP"     >&2; exit 1; }
echo "$PREFIX" | grep -qE '^[0-9]{1,2}$'                   || { echo "Bad prefix" >&2; exit 1; }

# Kill any running DHCP client for this interface first
kill "$(cat /var/run/dhclient.${IFACE}.pid 2>/dev/null)" 2>/dev/null || true
killall -q "dhclient" 2>/dev/null || true

cat > "$FILE" << EOF
[Match]
Name=$IFACE

[Network]
Address=$IP/$PREFIX
EOF

if [ -n "$GW" ]; then
  echo "$GW" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || { echo "Bad gateway" >&2; exit 1; }
  printf '\n[Route]\nGateway=%s\n' "$GW" >> "$FILE"
fi

# Apply immediately
if systemctl is-active --quiet systemd-networkd 2>/dev/null; then
  networkctl reload 2>/dev/null || systemctl restart systemd-networkd
else
  ip addr flush dev "$IFACE" 2>/dev/null || true
  ip addr add "$IP/$PREFIX" dev "$IFACE"
  ip link set "$IFACE" up
  if [ -n "$GW" ]; then
    ip route replace default via "$GW" dev "$IFACE" 2>/dev/null || true
  fi
fi

echo "Static $IP/$PREFIX applied on $IFACE"
