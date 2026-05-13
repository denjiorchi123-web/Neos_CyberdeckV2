#!/bin/bash
set -e

source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build

echo "=== Starting CyberDeck OS build ==="
echo "Start time: $(date)"
echo "Machine: cyberdeck-pi5"
echo "Distro: cyberdeck"
echo ""

bitbake cyberdeck-image 2>&1

echo ""
echo "=== Build complete ==="
echo "End time: $(date)"
echo "=== Deploy images ==="
ls -lh ~/cyberdeck/tmp/deploy/images/cyberdeck-pi5/ 2>/dev/null || echo "No images found"
