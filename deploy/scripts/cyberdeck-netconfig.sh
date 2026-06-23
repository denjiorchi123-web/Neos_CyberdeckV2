#!/bin/sh
set -eu

fail() {
  echo "cyberdeck-netconfig: $*" >&2
  exit 1
}

valid_ipv4() {
  old_ifs=$IFS
  IFS=.
  set -- $1
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1
  for octet in "$@"; do
    case "$octet" in ''|*[!0-9]*) return 1 ;; esac
    [ "$octet" -ge 0 ] 2>/dev/null && [ "$octet" -le 255 ] || return 1
  done
}

[ "$(id -u)" -eq 0 ] || fail "must run as root"
[ "$#" -ge 2 ] || fail "usage: <interface> <static|dhcp> [ip prefix gateway]"

IFACE=$1
MODE=$2

case "$IFACE" in *[!A-Za-z0-9_.-]*) fail "invalid characters in interface name" ;; esac
case "$IFACE" in
  eth[0-9]*|en[A-Za-z0-9_.-]*|usb[0-9]*|bat0) ;;
  *) fail "unsupported Ethernet interface: $IFACE" ;;
esac
[ -d "/sys/class/net/$IFACE" ] || fail "interface does not exist: $IFACE"

case "$MODE" in
  static)
    [ "$#" -ge 4 ] || fail "static mode requires IP and prefix"
    IP=$3
    PREFIX=$4
    GATEWAY=${5:-}
    valid_ipv4 "$IP" || fail "invalid IPv4 address: $IP"
    case "$PREFIX" in ''|*[!0-9]*) fail "invalid prefix: $PREFIX" ;; esac
    [ "$PREFIX" -ge 1 ] && [ "$PREFIX" -le 32 ] || fail "prefix must be 1-32"
    [ -z "$GATEWAY" ] || valid_ipv4 "$GATEWAY" || fail "invalid gateway: $GATEWAY"
    ;;
  dhcp)
    IP=""
    PREFIX=""
    GATEWAY=""
    ;;
  *) fail "mode must be static or dhcp" ;;
esac

apply_network_manager() {
  connection=$(nmcli -g GENERAL.CONNECTION device show "$IFACE" 2>/dev/null | head -n 1 || true)
  if [ -z "$connection" ] || [ "$connection" = "--" ]; then
    connection="cyberdeck-$IFACE"
    if ! nmcli -g NAME connection show "$connection" >/dev/null 2>&1; then
      nmcli connection add type ethernet ifname "$IFACE" con-name "$connection" >/dev/null
    fi
  fi

  if [ "$MODE" = "dhcp" ]; then
    nmcli connection modify "$connection" \
      connection.interface-name "$IFACE" \
      connection.autoconnect yes \
      ipv4.method auto \
      ipv4.addresses "" \
      ipv4.gateway "" \
      ipv4.dns "" \
      ipv4.never-default no \
      ipv6.method disabled
  else
    never_default=yes
    [ -z "$GATEWAY" ] || never_default=no
    nmcli connection modify "$connection" \
      connection.interface-name "$IFACE" \
      connection.autoconnect yes \
      ipv4.method manual \
      ipv4.addresses "$IP/$PREFIX" \
      ipv4.gateway "$GATEWAY" \
      ipv4.dns "" \
      ipv4.never-default "$never_default" \
      ipv6.method disabled
  fi

  nmcli connection up "$connection" ifname "$IFACE" >/dev/null
}

apply_networkd() {
  config="/etc/systemd/network/20-cyberdeck-$IFACE.network"
  temp=$(mktemp)
  {
    echo "[Match]"
    echo "Name=$IFACE"
    echo
    echo "[Network]"
    if [ "$MODE" = "dhcp" ]; then
      echo "DHCP=ipv4"
    else
      echo "Address=$IP/$PREFIX"
      [ -z "$GATEWAY" ] || echo "Gateway=$GATEWAY"
      echo "DHCP=no"
    fi
    echo "IPv6AcceptRA=no"
  } > "$temp"
  install -o root -g root -m 0644 "$temp" "$config"
  rm -f "$temp"
  networkctl reload
  networkctl reconfigure "$IFACE"
}

apply_dhcpcd() {
  config=/etc/dhcpcd.conf
  temp=$(mktemp)
  awk -v begin="# BEGIN CYBERDECK $IFACE" -v end="# END CYBERDECK $IFACE" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    !skip { print }
  ' "$config" > "$temp"

  if [ "$MODE" = "static" ]; then
    {
      echo
      echo "# BEGIN CYBERDECK $IFACE"
      echo "interface $IFACE"
      echo "static ip_address=$IP/$PREFIX"
      [ -z "$GATEWAY" ] || echo "static routers=$GATEWAY"
      echo "# END CYBERDECK $IFACE"
    } >> "$temp"
  fi

  install -o root -g root -m 0644 "$temp" "$config"
  rm -f "$temp"
  systemctl restart dhcpcd.service
}

if command -v nmcli >/dev/null 2>&1 && systemctl is-active --quiet NetworkManager.service; then
  apply_network_manager
  manager=NetworkManager
elif command -v networkctl >/dev/null 2>&1 && systemctl is-active --quiet systemd-networkd.service; then
  apply_networkd
  manager=systemd-networkd
elif command -v dhcpcd >/dev/null 2>&1 && systemctl is-active --quiet dhcpcd.service; then
  apply_dhcpcd
  manager=dhcpcd
else
  fail "no supported active network manager found"
fi

if [ "$MODE" = "static" ]; then
  attempts=0
  while [ "$attempts" -lt 20 ]; do
    if ip -4 -o addr show dev "$IFACE" | grep -Fq " $IP/$PREFIX "; then
      echo "applied static $IP/$PREFIX to $IFACE using $manager"
      exit 0
    fi
    attempts=$((attempts + 1))
    sleep 0.25
  done
  fail "manager saved the profile but $IP/$PREFIX is not active on $IFACE"
fi

echo "enabled DHCP on $IFACE using $manager"
