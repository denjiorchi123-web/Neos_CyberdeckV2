#!/bin/bash
# Build the final runtime tree at /home/nova/cyberdeck-app-stage from the
# build dir at /home/nova/cyberdeck-app-build. Strip x64 binaries, keep arm64.
set -euo pipefail

WORK=/home/nova/cyberdeck-app-build
STAGE=/home/nova/cyberdeck-app-stage

cd "$WORK"

rm -rf "$STAGE"
mkdir -p "$STAGE"

# 1) Next.js standalone tree — server.js + minimal node_modules used at runtime
cp -a .next/standalone/. "$STAGE/"

# 2) Static assets (CSS/JS/fonts that standalone doesn't bundle)
mkdir -p "$STAGE/.next"
cp -a .next/static "$STAGE/.next/"

# 3) Other dirs the runtime expects
cp -a public "$STAGE/" 2>/dev/null || true
cp -a prisma "$STAGE/"
cp -a backend "$STAGE/"

# 4) Our custom HTTPS server replaces standalone's server.js
cp -a server.js "$STAGE/"
cp .env.example "$STAGE/.env"

# 5) Overlay arm64 binaries into the standalone node_modules
mkdir -p "$STAGE/node_modules/@img" "$STAGE/node_modules/@next" \
         "$STAGE/node_modules/@prisma" "$STAGE/node_modules/.prisma"

# sharp + libvips arm64
cp -a node_modules/@img/sharp-linux-arm64           "$STAGE/node_modules/@img/" 2>/dev/null || true
cp -a node_modules/@img/sharp-libvips-linux-arm64   "$STAGE/node_modules/@img/" 2>/dev/null || true
cp -a node_modules/sharp                            "$STAGE/node_modules/"      2>/dev/null || true

# next-swc arm64
cp -a node_modules/@next/swc-linux-arm64-gnu        "$STAGE/node_modules/@next/" 2>/dev/null || true

# Prisma client + generated arm64 engine
cp -a node_modules/@prisma/client                   "$STAGE/node_modules/@prisma/" 2>/dev/null || true
cp -a node_modules/.prisma/client                   "$STAGE/node_modules/.prisma/" 2>/dev/null || true

# node-pty (terminal emulator) — ARM64 prebuilt native addon
if [ -d node_modules/node-pty ]; then
  rm -rf "$STAGE/node_modules/node-pty"
  cp -a node_modules/node-pty "$STAGE/node_modules/"
  find "$STAGE/node_modules/node-pty/prebuilds" -mindepth 1 -maxdepth 1 \
    ! -name 'linux-arm64' -exec rm -rf {} + 2>/dev/null || true
fi

# 6) Drop any x64 native binaries that snuck through (we keep ONLY arm64)
echo "[strip] removing x64 binaries..."
find "$STAGE/node_modules" -type d \( \
  -name 'sharp-linux-x64' -o \
  -name 'sharp-libvips-linux-x64' -o \
  -name 'swc-linux-x64-gnu' -o \
  -name 'swc-linux-x64-musl' -o \
  -name 'sharp-linux-x64-musl' -o \
  -name 'sharp-darwin-*' -o \
  -name 'sharp-win32-*' -o \
  -name 'swc-darwin-*' -o \
  -name 'swc-win32-*' \
\) -prune -exec rm -rf {} + 2>/dev/null

# Drop the prisma "native" query engine (x64) — keep only arm64
find "$STAGE/node_modules/.prisma" -name 'libquery_engine-debian-openssl-3.0.x*' -delete 2>/dev/null || true
find "$STAGE/node_modules/.prisma" -name 'libquery_engine-rhel-*'                -delete 2>/dev/null || true
find "$STAGE/node_modules" -name 'libquery_engine-debian-openssl-3.0.x*' -delete 2>/dev/null || true

# 7) Drop devDependencies that slipped in (eslint, types, prisma CLI)
echo "[strip] removing dev deps..."
for d in eslint eslint-config-next @typescript-eslint @types typescript prisma .bin .package-lock.json; do
  find "$STAGE/node_modules" -maxdepth 2 -name "$d" -prune -exec rm -rf {} + 2>/dev/null || true
done

# 8) Strip docs/tests/markdown/source maps (saves a LOT)
echo "[strip] removing docs and source maps..."
find "$STAGE/node_modules" -type f \( \
  -name '*.md' -o -name '*.markdown' -o -name 'CHANGELOG*' -o -name 'README*' -o \
  -name '*.map' -o -name '*.ts' -o -name '*.flow' -o -name '*.coffee' -o \
  -name 'LICENSE*' -o -name 'AUTHORS*' -o -name 'CONTRIBUTING*' \
\) -delete 2>/dev/null
find "$STAGE/node_modules" -type d \( \
  -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'docs' -o \
  -name 'doc' -o -name 'examples' -o -name 'example' -o -name '.github' \
\) -prune -exec rm -rf {} + 2>/dev/null

echo ""
echo "Final tree:"
du -sh "$STAGE"
echo ""
echo "Top contributors:"
du -sh "$STAGE"/* 2>/dev/null | sort -hr | head -10
echo ""
echo "node_modules breakdown:"
du -sh "$STAGE/node_modules"/* 2>/dev/null | sort -hr | head -15
