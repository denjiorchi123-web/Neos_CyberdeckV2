#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

SSHD_CONFIG="/etc/ssh/sshd_config.d/99-cyberdeck-lan.conf"

echo "[CyberDeck] Installing/enabling LAN SSH defaults..."

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y openssh-server
fi

mkdir -p /etc/ssh/sshd_config.d

cat > "$SSHD_CONFIG" <<'EOF'
# CyberDeck LAN-only SSH defaults.
# Intended for air-gapped Ethernet administration.
Port 22
AddressFamily inet
ListenAddress 0.0.0.0
PermitRootLogin no
PasswordAuthentication yes
KbdInteractiveAuthentication yes
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding no
ClientAliveInterval 60
ClientAliveCountMax 3
EOF

if command -v ssh-keygen >/dev/null 2>&1; then
  ssh-keygen -A
fi

echo "[CyberDeck] Enabling automatic IPv4 link-local on eth0..."
if command -v nmcli >/dev/null 2>&1; then
  if ! nmcli -t -f NAME con show | grep -qx "cyberdeck-lan"; then
    nmcli con add type ethernet ifname eth0 con-name cyberdeck-lan autoconnect yes >/dev/null 2>&1 || true
  fi
  nmcli con mod cyberdeck-lan \
    connection.interface-name eth0 \
    connection.autoconnect yes \
    ipv4.method link-local \
    ipv4.never-default yes \
    ipv6.method disabled >/dev/null 2>&1 || true
  nmcli con up cyberdeck-lan >/dev/null 2>&1 || true
elif command -v networkctl >/dev/null 2>&1; then
  mkdir -p /etc/systemd/network
  cat > /etc/systemd/network/10-cyberdeck-eth0.network <<'EOF'
[Match]
Name=eth0

[Network]
DHCP=no
LinkLocalAddressing=ipv4
IPv6AcceptRA=no
EOF
  systemctl enable systemd-networkd.service >/dev/null 2>&1 || true
  systemctl restart systemd-networkd.service >/dev/null 2>&1 || true
elif [ -f /etc/dhcpcd.conf ]; then
  if ! grep -q "CyberDeck eth0 link-local" /etc/dhcpcd.conf; then
    cat >> /etc/dhcpcd.conf <<'EOF'

# CyberDeck eth0 link-local fallback for direct cable pairing.
interface eth0
ipv4ll
noipv6
EOF
  fi
  systemctl restart dhcpcd.service >/dev/null 2>&1 || true
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl unmask ssh.service 2>/dev/null || true
  systemctl unmask sshd.service 2>/dev/null || true
  systemctl enable ssh.service 2>/dev/null || systemctl enable sshd.service 2>/dev/null || true
  systemctl restart ssh.service 2>/dev/null || systemctl restart sshd.service 2>/dev/null || true
fi

echo "[CyberDeck] LAN SSH enabled."
echo "[CyberDeck] eth0 will self-assign a 169.254.x.x address when no router is present."
echo "[CyberDeck] Verify with: systemctl is-active ssh || systemctl is-active sshd"
echo "[CyberDeck] From another LAN node: ssh <user>@<pi-ethernet-ip>"
