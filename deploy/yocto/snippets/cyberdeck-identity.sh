#!/bin/sh
# Read /data/node.conf and apply per-node identity:
#   - /etc/hostname → deck-NN
#   - patch /etc/systemd/network/15-bat0.network to use 10.0.0.NN/24
#
# eth0 has no IP — it's the raw mesh transport for batman-adv. The logical IP
# lives on bat0, the batadv virtual interface.
#
# /data/node.conf format (one line):
#   NODE_ID=01
set -eu

CONF="/data/node.conf"
NETF="/etc/systemd/network/15-bat0.network"

if [ ! -f "$CONF" ]; then
  echo "[identity] $CONF missing — defaulting to deck-99 (orphan)" >&2
  mkdir -p /data
  echo "NODE_ID=99" > "$CONF"
fi

# shellcheck disable=SC1090
. "$CONF"
NODE_ID="${NODE_ID:-99}"

HOSTNAME="deck-${NODE_ID}"
# Strip leading zeros for IP literal (10.0.0.01 is invalid in some parsers)
NODE_IP_OCTET=$(printf '%d' "$NODE_ID")
IP="10.0.0.${NODE_IP_OCTET}"

# Temporarily remount rootfs as RW to patch read-only system configurations
mount -o remount,rw /

# Hostname
echo "$HOSTNAME" > /etc/hostname
hostname "$HOSTNAME"

# Patch the bat0 network config in-place
if [ -f "$NETF" ]; then
  sed -i "s|^Address=.*|Address=${IP}/24|" "$NETF"
fi

# Remount rootfs back to RO to maintain strict security
mount -o remount,ro /

# Make sure the batman-adv module is loaded before networkd brings bat0 up.
# /etc/modules-load.d/batman-adv.conf usually handles this at boot, but on
# the first ever boot the file may not have been honored yet.
modprobe batman-adv 2>/dev/null || true

# Tell systemd-networkd to reload (creates bat0 if it isn't already up)
# REMOVED: This script runs Before=systemd-networkd.service, so networkd
# hasn't started yet. Calling systemctl reload-or-restart here creates an
# infinite deadlock. Networkd will read the patched file when it naturally starts.
# networkctl reload 2>/dev/null || systemctl reload-or-restart systemd-networkd

echo "[identity] node=$NODE_ID host=$HOSTNAME ip=$IP iface=bat0 mesh=eth0"
