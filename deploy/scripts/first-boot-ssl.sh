#!/bin/sh
# Generate a self-signed cert on first boot if one doesn't already exist.
# Bound to cyberdeck.local; the device should expose this name via avahi or /etc/hosts.
set -eu

CERT_DIR="/opt/cyberdeck/ssl"
CERT="$CERT_DIR/server.cert"
KEY="$CERT_DIR/server.key"

if [ -s "$CERT" ] && [ -s "$KEY" ]; then
  exit 0
fi

mkdir -p "$CERT_DIR"

# Build a SAN list that covers:
#   - cyberdeck.local + any *.local hostname (so cyberdeck-alpha.local, cyberdeck-beta.local,
#     etc. all validate when one Pi's browser connects to another peer)
#   - localhost / 127.0.0.1 for the kiosk's own connection
#   - this device's primary LAN IP (whatever it picked up from DHCP / link-local)
#   - any static peer IPs the operator listed in peers.json — so when Pi A's browser
#     navigates to Pi B by IP literal the cert still validates
SAN="DNS:cyberdeck.local,DNS:*.local,DNS:localhost,IP:127.0.0.1"
# Static 4-node LAN — every Pi's cert validates connections targeting any deck IP
SAN="$SAN,IP:10.0.0.1,IP:10.0.0.2,IP:10.0.0.3,IP:10.0.0.4"

# Add our own IPs (skip loopback and link-local IPv6 fe80::)
for ip in $(hostname -I 2>/dev/null || true); do
  case "$ip" in
    127.*|::1|fe80:*) continue ;;
  esac
  SAN="$SAN,IP:$ip"
done

# Add static peer IPs from peers.json (best-effort, no jq dependency)
PEERS_FILE="${CYBERDECK_PEERS_FILE:-/opt/cyberdeck/peers.json}"
if [ -f "$PEERS_FILE" ]; then
  # Grep IPv4 literals out of "address": "x.x.x.x" fields
  for ip in $(grep -oE '"address"[[:space:]]*:[[:space:]]*"[0-9.]+"' "$PEERS_FILE" \
              | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' || true); do
    SAN="$SAN,IP:$ip"
  done
fi

openssl req -x509 -newkey rsa:2048 \
  -keyout "$KEY" -out "$CERT" \
  -days 3650 -nodes \
  -subj "/CN=cyberdeck.local" \
  -addext "subjectAltName=$SAN"

chmod 600 "$KEY"
chmod 644 "$CERT"
echo "[first-boot-ssl] Generated new self-signed cert for cyberdeck.local"
