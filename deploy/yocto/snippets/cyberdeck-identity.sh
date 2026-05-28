#!/bin/sh
# Setup identity and bind eth0 to bat0
set -eu

# Bind eth0 to batman-adv
batctl if add eth0 || true

# Bring bat0 up
ip link set up dev bat0 || true

CONF="/data/node.conf"
if [ ! -f "$CONF" ]; then
  mkdir -p /data
  echo "NODE_ID=99" > "$CONF"
fi

. "$CONF"
NODE_ID="${NODE_ID:-99}"
HOSTNAME="deck-${NODE_ID}"
IP="10.0.0.${NODE_ID}"

mount -o remount,rw /
echo "$HOSTNAME" > /etc/hostname
hostname "$HOSTNAME"
sed -i "s|^Address=.*|Address=${IP}/24|" /etc/systemd/network/15-bat0.network || true
mount -o remount,ro /
