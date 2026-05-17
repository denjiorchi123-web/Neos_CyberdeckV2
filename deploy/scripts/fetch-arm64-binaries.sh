#!/bin/bash
# Fetch arm64 prebuilt binary packages and inject into the build tree.
# npm refuses to "install" platform-incompatible packages, so we use `npm pack`
# (download-only, no platform check) and extract manually.
set -euo pipefail

export PATH="/home/nova/local/node/bin:/usr/bin:/bin"

WORK=/home/nova/cyberdeck-app-build
DL=/tmp/arm64-fetch

rm -rf "$DL"
mkdir -p "$DL"
cd "$DL"

# npm pack downloads the tarball without running install scripts or checking
# os/cpu/libc — perfect for cross-platform staging.
for pkg in @img/sharp-linux-arm64 @img/sharp-libvips-linux-arm64 @next/swc-linux-arm64-gnu node-pty; do
  echo "[fetch] $pkg"
  npm pack "$pkg" 2>&1 | tail -1
done

ls -lh "$DL"/*.tgz

# Extract each tarball into its node_modules slot.
extract_pkg() {
  local tgz="$1"
  local dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  tar -xzf "$tgz" -C "$dest" --strip-components=1
}

# Tarball names are normalized by npm pack: scope-name-version.tgz
SHARP=$(ls "$DL"/img-sharp-linux-arm64-*.tgz)
LIBVIPS=$(ls "$DL"/img-sharp-libvips-linux-arm64-*.tgz)
SWC=$(ls "$DL"/next-swc-linux-arm64-gnu-*.tgz)
NPTY=$(ls "$DL"/node-pty-*.tgz)

mkdir -p "$WORK/node_modules/@img" "$WORK/node_modules/@next"
extract_pkg "$SHARP"    "$WORK/node_modules/@img/sharp-linux-arm64"
extract_pkg "$LIBVIPS"  "$WORK/node_modules/@img/sharp-libvips-linux-arm64"
extract_pkg "$SWC"      "$WORK/node_modules/@next/swc-linux-arm64-gnu"
extract_pkg "$NPTY"     "$WORK/node_modules/node-pty"

# For node-pty: keep only linux-arm64 prebuilt to save space
find "$WORK/node_modules/node-pty/prebuilds" -mindepth 1 -maxdepth 1 \
  ! -name 'linux-arm64' -exec rm -rf {} + 2>/dev/null || true

# Strip the x64 variants that npm pulled in during build — Pi can't use them.
rm -rf "$WORK/node_modules/@img/sharp-linux-x64" 2>/dev/null || true
rm -rf "$WORK/node_modules/@img/sharp-libvips-linux-x64" 2>/dev/null || true
rm -rf "$WORK/node_modules/@next/swc-linux-x64-gnu" 2>/dev/null || true

echo ""
echo "[ok] arm64 binaries injected:"
ls -d "$WORK/node_modules/@img/"*arm64* "$WORK/node_modules/@next/"*arm64* \
      "$WORK/node_modules/node-pty" 2>/dev/null
