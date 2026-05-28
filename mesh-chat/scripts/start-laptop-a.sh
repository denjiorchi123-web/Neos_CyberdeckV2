#!/usr/bin/env bash
# Laptop-A (192.168.1.1)
# Run on Windows in Git Bash:  bash scripts/start-laptop-a.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== CyberDeck Mesh — Laptop-A ==="
echo "Folder: $ROOT"

if [[ ! -f .env.laptop-a ]]; then
  echo "ERROR: .env.laptop-a not found. Run this from the mesh-chat folder."
  exit 1
fi

echo "Copying .env.laptop-a -> .env"
cp -f .env.laptop-a .env

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org then reopen Git Bash."
  exit 1
fi

echo "Node: $(node -v)"
echo "Installing dependencies..."
npm install

echo ""
echo "============================================"
echo "  UI:  https://192.168.1.1:3000"
echo "  (Click Advanced -> Proceed if browser warns about certificate)"
echo "  Start Laptop-B after this is running."
echo "============================================"
echo "Press Ctrl+C to stop."
node server.js
