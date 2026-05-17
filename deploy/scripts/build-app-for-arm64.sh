#!/bin/bash
# Build the Next.js app on WSL x86_64, then swap in linux-arm64 native binaries
# (sharp, next-swc, prisma engine, node-pty) for the final tree shipped to the Pi 5.
#
# Two-phase approach is needed because Next's `next build` runs locally and
# requires host-platform SWC, but the runtime needs target-platform SWC.
set -euo pipefail

# Prefer nvm-managed node, then system node, then fallback path
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:/usr/local/bin:/usr/bin:/bin"

PROJ_SRC="${PROJ_SRC:-/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS}"
WORK_DIR="$HOME/cyberdeck-app-build"

# 1) Copy source
echo "[1/7] Copying source..."
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .next \
  --exclude 'prisma/dev.db*' --exclude .git \
  --exclude private/uploads --exclude public/uploads \
  --exclude scratch --exclude '*.tsbuildinfo' \
  "$PROJ_SRC/" "$WORK_DIR/"

cd "$WORK_DIR"

# 2) Host-platform install — needed so `next build` and `prisma generate` can run.
echo "[2/7] npm install (host platform, for build tools)..."
npm install --include=optional --no-audit --no-fund --loglevel=error 2>&1 | tail -5

# 3) Prisma generate — schema has binaryTargets including linux-arm64-openssl-3.0.x.
echo "[3/7] prisma generate (both native + linux-arm64 engines)..."
npx --yes prisma generate 2>&1 | tail -5

# 4) Build
echo "[4/7] next build..."
npm run build 2>&1 | tail -10

# 5) Now swap in arm64 binaries for the runtime tree.
# Sharp and next-swc are the two native deps. Prisma already has both engines
# in node_modules/.prisma/client/ thanks to the binaryTargets above.
echo "[5/7] Fetching linux-arm64 native binaries (sharp, next-swc)..."
npm install --no-save --include=optional \
  --cpu=arm64 --os=linux --libc=glibc \
  @img/sharp-linux-arm64 \
  @next/swc-linux-arm64-gnu \
  2>&1 | tail -5

# 5.5) node-pty ARM64 prebuild — terminal emulator native addon.
# node-pty ships prebuilds/linux-arm64/node.napi.node inside the package.
# We just need the whole package present in the staged tree; the prebuilds/
# directory is sufficient — no separate npm install needed.
echo "[5.5/7] Staging node-pty ARM64 prebuild..."
if [ -d node_modules/node-pty ]; then
  echo "  node-pty found in node_modules — will be overlaid in stage step"
else
  echo "  WARNING: node_modules/node-pty missing — run npm ci first" >&2
fi

# 6) Stage the runtime tree
STAGE_DIR="$HOME/cyberdeck-app-stage"
echo "[6/7] Staging to $STAGE_DIR..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Next standalone tree (server.js, minimal node_modules used by runtime)
cp -a .next/standalone/. "$STAGE_DIR/"

# Static assets — standalone doesn't include these
mkdir -p "$STAGE_DIR/.next"
cp -a .next/static "$STAGE_DIR/.next/"

# Our custom HTTPS server.js, FastAPI backend, prisma schema
cp -a public "$STAGE_DIR/" 2>/dev/null || true
cp -a prisma "$STAGE_DIR/"
cp -a backend "$STAGE_DIR/"
cp -a server.js "$STAGE_DIR/"
# Write a Pi-ready .env (localhost refs work on-device since everything is loopback)
cat > "$STAGE_DIR/.env" << 'ENVEOF'
DATABASE_URL="file:./prisma/dev.db?journal_mode=WAL"
REDIS_URL=redis://127.0.0.1:6379
NEXT_PUBLIC_SITE_URL=https://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
CYBERDECK_HOME=/opt/cyberdeck
ENVEOF
[ -f package.json ] && cp package.json "$STAGE_DIR/"

# Make sure the arm64 native modules are in the staged node_modules.
# Next standalone may have only included the x64 variants — we overlay the arm64 ones.
mkdir -p "$STAGE_DIR/node_modules/@img" "$STAGE_DIR/node_modules/@next" "$STAGE_DIR/node_modules/@prisma" "$STAGE_DIR/node_modules/.prisma"

# Sharp arm64
if [ -d node_modules/@img/sharp-linux-arm64 ]; then
  rm -rf "$STAGE_DIR/node_modules/@img/sharp-linux-arm64"
  cp -a node_modules/@img/sharp-linux-arm64 "$STAGE_DIR/node_modules/@img/"
fi
# Sharp libvips (shared lib that sharp loads)
if [ -d node_modules/@img/sharp-libvips-linux-arm64 ]; then
  cp -a node_modules/@img/sharp-libvips-linux-arm64 "$STAGE_DIR/node_modules/@img/"
fi
# Sharp wrapper (the main sharp package — small, always copy)
if [ -d node_modules/sharp ]; then
  rm -rf "$STAGE_DIR/node_modules/sharp"
  cp -a node_modules/sharp "$STAGE_DIR/node_modules/"
fi
# next-swc arm64
if [ -d node_modules/@next/swc-linux-arm64-gnu ]; then
  rm -rf "$STAGE_DIR/node_modules/@next/swc-linux-arm64-gnu"
  cp -a node_modules/@next/swc-linux-arm64-gnu "$STAGE_DIR/node_modules/@next/"
fi
# Remove x64 variants to save space — Pi can't run them anyway
rm -rf "$STAGE_DIR/node_modules/@next/swc-linux-x64-gnu" 2>/dev/null || true
rm -rf "$STAGE_DIR/node_modules/@img/sharp-linux-x64" 2>/dev/null || true
rm -rf "$STAGE_DIR/node_modules/@img/sharp-libvips-linux-x64" 2>/dev/null || true

# Prisma client (already generated for arm64 + native)
if [ -d node_modules/@prisma/client ]; then
  rm -rf "$STAGE_DIR/node_modules/@prisma/client"
  cp -a node_modules/@prisma/client "$STAGE_DIR/node_modules/@prisma/"
fi
if [ -d node_modules/.prisma/client ]; then
  rm -rf "$STAGE_DIR/node_modules/.prisma/client"
  cp -a node_modules/.prisma/client "$STAGE_DIR/node_modules/.prisma/"
  # Drop the native (x64) prisma engine — keep only linux-arm64
  find "$STAGE_DIR/node_modules/.prisma/client" -name 'libquery_engine-*' ! -name '*linux-arm64*' -delete 2>/dev/null || true
fi

# node-pty (terminal emulator) — full package; prebuilds/linux-arm64/ is the runtime native
if [ -d node_modules/node-pty ]; then
  rm -rf "$STAGE_DIR/node_modules/node-pty"
  cp -a node_modules/node-pty "$STAGE_DIR/node_modules/"
  # Drop non-arm64 prebuilds to keep the image lean
  find "$STAGE_DIR/node_modules/node-pty/prebuilds" -mindepth 1 -maxdepth 1 \
    ! -name 'linux-arm64' -exec rm -rf {} + 2>/dev/null || true
fi

# 7) Summary
echo ""
echo "[7/7] Complete"
echo "Tree size:"
du -sh "$STAGE_DIR"
echo "Breakdown:"
du -sh "$STAGE_DIR"/* 2>/dev/null | sort -h
echo ""
echo "[done] Built tree at $STAGE_DIR"
