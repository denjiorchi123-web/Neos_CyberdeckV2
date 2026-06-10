#!/bin/bash
# Sets a static IP on the primary ethernet interface for direct cable connection
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo:"
  echo "sudo $0 <IP_ADDRESS>"
  exit 1
fi

IP="$1"
if [ -z "$IP" ]; then
  echo "Usage: sudo $0 <IP_ADDRESS>"
  echo "Example: sudo $0 10.0.0.1"
  exit 1
fi

# Detect primary ethernet interface (usually eth0 or end0)
IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|en)' | head -n 1)

if [ -z "$IFACE" ]; then
  echo "Error: No ethernet interface found."
  exit 1
fi

echo "Configuring interface: $IFACE with static IP: $IP/24"

# Check if NetworkManager is active
if command -v nmcli &> /dev/null && systemctl is-active --quiet NetworkManager; then
  echo "Detected NetworkManager. Applying static IP via nmcli..."
  
  # Check if a connection exists for this interface, otherwise create it
  CONN_NAME=$(nmcli -t -f NAME,DEVICE connection show active | grep ":$IFACE" | cut -d: -f1)
  
  if [ -z "$CONN_NAME" ]; then
    CONN_NAME="Wired connection 1"
    # Create it if it doesn't exist at all
    if ! nmcli connection show "$CONN_NAME" &> /dev/null; then
      nmcli connection add type ethernet ifname "$IFACE" con-name "$CONN_NAME"
    fi
  fi
  
  nmcli connection modify "$CONN_NAME" ipv4.addresses "$IP/24" ipv4.method manual
  nmcli connection up "$CONN_NAME"
  
  echo "NetworkManager configuration complete."

# Check if dhcpcd is active
elif command -v dhcpcd &> /dev/null && systemctl is-active --quiet dhcpcd; then
  echo "Detected dhcpcd. Applying static IP to /etc/dhcpcd.conf..."
  
  # Remove existing static config for this interface if it exists
  sed -i "/^interface $IFACE/,/^$/d" /etc/dhcpcd.conf
  
  # Append new static config
  echo "" >> /etc/dhcpcd.conf
  echo "interface $IFACE" >> /etc/dhcpcd.conf
  echo "static ip_address=$IP/24" >> /etc/dhcpcd.conf
  
  systemctl restart dhcpcd
  echo "dhcpcd configuration complete."

else
  echo "Error: Neither NetworkManager nor dhcpcd were detected."
  echo "You will need to manually assign the static IP using standard Linux network configuration."
  exit 1
fi

echo "Success! The IP address for $IFACE is now $IP."
echo "You can verify this by running: ip -4 addr show $IFACE"
