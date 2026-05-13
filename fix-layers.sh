#!/bin/bash
set -e

source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build

# Add meta-webserver layer (contains nginx)
echo "--- Adding meta-webserver layer ---"
bitbake-layers add-layer ~/cyberdeck/sources/meta-openembedded/meta-webserver 2>&1

# Check what packages might be missing
echo "--- Checking key recipes ---"
for pkg in nginx foot weston ttf-dejavu-sans ttf-dejavu-sans-mono; do
    result=$(bitbake-layers show-recipes "$pkg" 2>/dev/null | grep -c "meta-" || true)
    if [ "$result" -gt 0 ]; then
        echo "  ✓ $pkg found"
    else
        echo "  ✗ $pkg NOT FOUND"
    fi
done

echo ""
echo "--- Layers ---"
bitbake-layers show-layers 2>&1 | grep -v "^NOTE" | grep -v "^WARNING"
