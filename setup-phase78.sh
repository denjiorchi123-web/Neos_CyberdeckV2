#!/bin/bash
set -e

# Phase 7 - alias
grep -q 'cdbuild' ~/.bashrc 2>/dev/null || echo "alias cdbuild='source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build'" >> ~/.bashrc
echo "Phase 7 done - alias added"

# Phase 8 - parse check
source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build
echo "--- Parse check ---"
bitbake cyberdeck-image -p 2>&1 | tail -12
