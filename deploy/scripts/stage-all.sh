#!/bin/bash
# CyberDeck — one-shot staging script.
# Copies the modified codebase into the meta-cyberdeck Yocto layer,
# builds the Next.js app for ARM64, and creates the Yocto recipe tarball.
#
# Run from WSL Ubuntu 24.04 BEFORE running bitbake:
#   bash deploy/scripts/stage-all.sh
#
# Prerequisites:
#   - Node 18+ (installed via nvm or apt)
#   - meta-cyberdeck layer at ~/cyberdeck/sources/meta-cyberdeck
#   - Poky + BSP layers at ~/cyberdeck/sources/
set -euo pipefail

export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:/usr/local/bin:/usr/bin:/bin"

PROJ="${PROJ:-/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS}"
META="${META:-$HOME/cyberdeck/sources/meta-cyberdeck}"

echo "════════════════════════════════════════════════════"
echo "  CyberDeck full staging pipeline"
echo "  Project : $PROJ"
echo "  Layer   : $META"
echo "════════════════════════════════════════════════════"

# ── 1. Stage meta-cyberdeck recipes ──────────────────────────────────────────
echo ""
echo "[1/4] Staging meta-cyberdeck layer files..."
PROJ="$PROJ" META="$META" bash "$PROJ/deploy/scripts/stage-meta-cyberdeck.sh"

# ── 2. Build Next.js for ARM64 ───────────────────────────────────────────────
echo ""
echo "[2/4] Building Next.js app for ARM64..."
bash "$PROJ/deploy/scripts/build-app-for-arm64.sh"

# ── 3. Stage the recipe tarball ───────────────────────────────────────────────
echo ""
echo "[3/4] Creating Yocto recipe tarball..."
bash "$PROJ/deploy/scripts/stage-app-recipe.sh"

# (The obsolete cyberdeck.bb was removed, the app is built by cyberdeck-app.bb)

echo ""
echo "════════════════════════════════════════════════════"
echo "  Staging complete. You can now run bitbake."
echo "  See deploy/yocto/README.md for full bake commands."
echo "════════════════════════════════════════════════════"
