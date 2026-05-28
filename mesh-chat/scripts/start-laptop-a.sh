#!/usr/bin/env bash
# Laptop-A (192.168.1.1) — run from mesh-chat folder in Git Bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CyberDeck Mesh — Laptop-A ==="
echo "Copying .env.laptop-a -> .env"
cp -f .env.laptop-a .env

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Install Node.js first."
  exit 1
fi

echo "Installing dependencies..."
npm install

echo ""
echo "Starting server (UI: http://192.168.1.1:3000)..."
echo "Press Ctrl+C to stop."
node server.js
