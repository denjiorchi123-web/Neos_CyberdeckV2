#!/bin/bash
# CyberDeck — one-shot staging script.
# Copies the modified codebase into the meta-cyberdeck Yocto layer,
# builds the Next.js app for ARM64, and creates the Yocto recipe tarball.
#
# Run from WSL Ubuntu 24.04 BEFORE running bitbake:
#   bash deploy/scripts/stage-all.sh
#
# Prerequisites:
#   - Node 18+ at /home/nova/local/node/bin  (or on PATH)
#   - meta-cyberdeck layer at ~/cyberdeck/sources/meta-cyberdeck
#   - Poky + BSP layers at ~/cyberdeck/sources/
set -euo pipefail

export PATH="/home/nova/local/node/bin:/usr/bin:/bin:/usr/local/bin"

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

# ── 4. Copy the main cyberdeck.bb recipe into the layer ──────────────────────
echo ""
echo "[4/4] Installing cyberdeck.bb into layer..."
RECIPE_DIR="$META/recipes-cyberdeck/cyberdeck"
mkdir -p "$RECIPE_DIR"
cp "$PROJ/deploy/yocto/cyberdeck.bb" "$RECIPE_DIR/cyberdeck.bb"

# Copy systemd units and scripts into the recipe's files/ dir
# (the recipe references them from /opt/cyberdeck/deploy/... at install time,
#  so no separate copy is needed — they're already inside the tarball)

echo ""
echo "════════════════════════════════════════════════════"
echo "  Staging complete. You can now run bitbake."
echo "  See deploy/yocto/README.md for full bake commands."
echo "════════════════════════════════════════════════════"
