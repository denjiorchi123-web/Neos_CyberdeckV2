#!/bin/bash
set -e

source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build

# Add meta-chromium layer and its dependencies
echo "--- Adding meta-clang and scarthgap-rust-mixin layers ---"
bitbake-layers add-layer ~/cyberdeck/sources/meta-clang 2>&1 || echo "meta-clang failed"
bitbake-layers add-layer ~/cyberdeck/sources/scarthgap-rust-mixin 2>&1 || echo "rust-mixin failed"

echo "--- Adding meta-chromium layer ---"
bitbake-layers add-layer ~/cyberdeck/sources/meta-browser/meta-chromium 2>&1 || echo "meta-chromium failed"

# Add meta-webserver if not there
echo "--- Adding meta-webserver layer ---"
bitbake-layers add-layer ~/cyberdeck/sources/meta-openembedded/meta-webserver 2>&1 || echo "Already added or failed"

# Remove 'foot' from the image recipe as it's not available in our layers
echo "--- Modifying cyberdeck-image.bb to remove foot ---"
sed -i 's/    foot \\//' ~/cyberdeck/sources/meta-cyberdeck/recipes-core/images/cyberdeck-image.bb

# Add chromium-ozone-wayland to the image
echo "--- Adding chromium-ozone-wayland to image ---"
if ! grep -q "chromium-ozone-wayland" ~/cyberdeck/sources/meta-cyberdeck/recipes-core/images/cyberdeck-image.bb; then
    sed -i '/IMAGE_INSTALL:append = " \\/a \    chromium-ozone-wayland \\' ~/cyberdeck/sources/meta-cyberdeck/recipes-core/images/cyberdeck-image.bb
fi

echo "--- Current Layers ---"
bitbake-layers show-layers
