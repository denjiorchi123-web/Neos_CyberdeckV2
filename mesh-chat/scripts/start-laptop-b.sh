#!/usr/bin/env bash
# Laptop-B (192.168.1.2) — connects to Laptop-A at 192.168.1.1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CyberDeck Mesh — Laptop-B ==="
echo "Copying .env.laptop-b -> .env"
cp -f .env.laptop-b .env

PEER_IP="${PEER_IP:-192.168.1.1}"
echo "Peer (Laptop-A): $PEER_IP"

echo "Checking reachability to Laptop-A..."
if command -v ping >/dev/null 2>&1; then
  ping -n 2 "$PEER_IP" >/dev/null 2>&1 || ping -c 2 "$PEER_IP" >/dev/null 2>&1 || {
    echo "WARNING: Cannot ping $PEER_IP — check ethernet cable and static IPs."
  }
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Install Node.js first."
  exit 1
fi

echo "Installing dependencies..."
npm install

echo ""
echo "Starting server (UI: http://192.168.1.2:3000)"
echo "Will connect to Laptop-A at $PEER_IP ..."
echo "Press Ctrl+C to stop."
node server.js
