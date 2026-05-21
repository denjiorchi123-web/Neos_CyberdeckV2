#!/bin/bash
# Full CyberDeck bake pipeline:
#   1. Verify meta-clang is on scarthgap-clang20 (required by Chromium 147)
#   2. Stage chromium bbappend into meta-cyberdeck
#   3. Rebuild Next.js ARM64 app + tarball
#   4. Start bitbake cyberdeck-image
#
# Run from WSL:
#   bash /mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/scripts/_start-bake.sh
#
# Monitor progress:
#   tail -f ~/cyberdeck/build/bitbake.log
set -euo pipefail

PROJ="${PROJ:-/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS}"
YOCTO_ROOT="${YOCTO_ROOT:-$HOME/cyberdeck}"
META_CLANG="${YOCTO_ROOT}/sources/meta-clang"
META_CYBERDECK="${YOCTO_ROOT}/sources/meta-cyberdeck"
REQUIRED_CLANG_BRANCH="scarthgap-clang20"

# ── Step 1: Verify meta-clang is on the scarthgap-clang20 branch ──────────
echo ">>> Step 1: Checking meta-clang branch (Chromium 147 compatibility)..."
if [ ! -d "${META_CLANG}/.git" ]; then
  echo "ERROR: meta-clang not found at ${META_CLANG}"
  echo "  Clone it: git clone --branch ${REQUIRED_CLANG_BRANCH} \\"
  echo "    https://github.com/kraj/meta-clang.git ${META_CLANG}"
  exit 1
fi

CURRENT_BRANCH=$(git -C "${META_CLANG}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "${CURRENT_BRANCH}" != "${REQUIRED_CLANG_BRANCH}" ]; then
  echo ""
  echo "  ⚠  meta-clang is on '${CURRENT_BRANCH}', need '${REQUIRED_CLANG_BRANCH}'."
  echo "  Switching automatically..."
  # The repo may have been cloned with --single-branch (only 'scarthgap' was
  # fetched). Explicitly fetch the target branch refspec before checkout.
  git -C "${META_CLANG}" fetch origin "${REQUIRED_CLANG_BRANCH}:${REQUIRED_CLANG_BRANCH}"
  git -C "${META_CLANG}" checkout "${REQUIRED_CLANG_BRANCH}"
  git -C "${META_CLANG}" pull origin "${REQUIRED_CLANG_BRANCH}"
  echo "  ✓ meta-clang switched to ${REQUIRED_CLANG_BRANCH}."
  echo "  Cleaning stale clang-native sstate so Clang 20 is rebuilt..."
  # Can't run bitbake here yet (env not sourced) — delete sstate entries
  # for clang-native so bitbake rebuilds from the newly checked-out branch.
  find "${YOCTO_ROOT}/sstate-cache" -name "*clang-native*" -delete 2>/dev/null || true
  echo "  ✓ clang-native sstate cleared."
else
  echo "  ✓ meta-clang is on ${REQUIRED_CLANG_BRANCH}."
fi

# ── Step 2: Stage bbappend into meta-cyberdeck ───────────────────────────
echo ""
echo ">>> Step 2: Staging chromium bbappend..."
BBAPPEND_SRC="${PROJ}/deploy/yocto/snippets/chromium-ozone-wayland_147.0.7727.116.bbappend"
BBAPPEND_DST_DIR="${META_CYBERDECK}/recipes-browser/chromium"
if [ -f "${BBAPPEND_SRC}" ] && [ -d "${META_CYBERDECK}" ]; then
  mkdir -p "${BBAPPEND_DST_DIR}"
  cp "${BBAPPEND_SRC}" "${BBAPPEND_DST_DIR}/"
  echo "  ✓ bbappend staged to ${BBAPPEND_DST_DIR}/"
else
  echo "  ⚠  Skipped: meta-cyberdeck not found or bbappend missing."
  echo "     Run stage-meta-cyberdeck.sh first if this is a fresh environment."
fi

# ── Step 3: Clean stale Chromium sstate so patches + bbappend take effect ─
echo ""
echo ">>> Step 3: Cleaning stale chromium-ozone-wayland sstate (patches changed)..."
cd "${YOCTO_ROOT}"
set +u
# shellcheck source=/dev/null
source sources/poky/oe-init-build-env build 2>/dev/null
set -u
bitbake -c cleansstate chromium-ozone-wayland
echo "  ✓ chromium-ozone-wayland sstate cleared — patches will be applied fresh."

# ── Step 4: Rebuild app tarball ───────────────────────────────────────────
echo ""
echo ">>> Step 4: Rebuilding app tarball..."
bash "$PROJ/deploy/scripts/_rebuild-tarball.sh"

# ── Step 5: Bake ──────────────────────────────────────────────────────────
echo ""
echo ">>> Step 5: Starting bitbake..."
cd "$YOCTO_ROOT"
# oe-init-build-env touches unbound vars (BBSERVER, ...) — disable -u for the
# source, then turn it back on for our own commands.
set +u
# shellcheck source=/dev/null
source sources/poky/oe-init-build-env build
set -u

echo ">>> Parsing recipes (this takes ~1 min)..."
bitbake -p

echo ">>> Baking cyberdeck-image..."
bitbake cyberdeck-image 2>&1 | tee "$YOCTO_ROOT/build/bitbake.log"
