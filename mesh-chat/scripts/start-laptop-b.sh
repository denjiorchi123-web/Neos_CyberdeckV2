#!/usr/bin/env bash
# Laptop-B (192.168.1.2) — connects to Laptop-A at 192.168.1.1
# Run on Windows in Git Bash:  bash scripts/start-laptop-b.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== CyberDeck Mesh — Laptop-B ==="
echo "Folder: $ROOT"

if [[ ! -f .env.laptop-b ]]; then
  echo "ERROR: .env.laptop-b not found. Run this from the mesh-chat folder."
  exit 1
fi

echo "Copying .env.laptop-b -> .env"
cp -f .env.laptop-b .env

PEER_IP="${PEER_IP:-192.168.1.1}"
echo "Peer (Laptop-A): $PEER_IP"

echo "Checking reachability to Laptop-A..."
if command -v ping >/dev/null 2>&1; then
  if [[ "$(uname -s 2>/dev/null)" == MINGW* ]] || [[ "$(uname -s 2>/dev/null)" == MSYS* ]] || [[ -n "${WINDIR:-}" ]]; then
    ping -n 2 "$PEER_IP" || echo "WARNING: Cannot ping $PEER_IP — check cable and static IPs."
  else
    ping -c 2 "$PEER_IP" || echo "WARNING: Cannot ping $PEER_IP — check cable and static IPs."
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org then reopen Git Bash."
  exit 1
fi

echo "Node: $(node -v)"
echo "Installing dependencies..."
npm install

echo ""
echo "============================================"
echo "  UI:     https://192.168.1.2:3000"
echo "  Peer:   https://${PEER_IP}:3001"
echo "  (Click Advanced -> Proceed if browser warns about certificate)"
echo "  Open browser, enter username, Join Network"
echo "============================================"
echo "Press Ctrl+C to stop."
node server.js
