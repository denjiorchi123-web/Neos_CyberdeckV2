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

if command -v systemctl >/dev/null 2>&1; then
  systemctl unmask ssh.service 2>/dev/null || true
  systemctl unmask sshd.service 2>/dev/null || true
  systemctl enable ssh.service 2>/dev/null || systemctl enable sshd.service 2>/dev/null || true
  systemctl restart ssh.service 2>/dev/null || systemctl restart sshd.service 2>/dev/null || true
fi

echo "[CyberDeck] LAN SSH enabled."
echo "[CyberDeck] Verify with: systemctl is-active ssh || systemctl is-active sshd"
echo "[CyberDeck] From another LAN node: ssh <user>@<pi-ethernet-ip>"
