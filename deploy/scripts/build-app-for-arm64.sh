#!/bin/bash
set -euo pipefail
WORK_DIR="$HOME/cyberdeck-app-build"
STAGE_DIR="$HOME/cyberdeck-app-stage"
PROJ_SRC="/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS"

rm -rf "$WORK_DIR" "$STAGE_DIR"
mkdir -p "$WORK_DIR" "$STAGE_DIR"
rsync -a --exclude node_modules --exclude .next --exclude .git "$PROJ_SRC/" "$WORK_DIR/"

cd "$WORK_DIR"
npm install --include=optional --no-audit --no-fund
npx --yes prisma generate
npm run build

npm install --no-save --include=optional --force --cpu=arm64 --os=linux --libc=glibc @img/sharp-linux-arm64 @next/swc-linux-arm64-gnu

cp -a .next/standalone/. "$STAGE_DIR/"
mkdir -p "$STAGE_DIR/.next"
cp -a .next/static "$STAGE_DIR/.next/"
cp -a public "$STAGE_DIR/" || true
cp -a prisma "$STAGE_DIR/"
cp -a backend "$STAGE_DIR/"
cp -a deploy "$STAGE_DIR/"
cp server.js "$STAGE_DIR/"

cat > "$STAGE_DIR/.env" << 'ENVEOF'
DATABASE_URL="file:./prisma/dev.db?journal_mode=WAL"
REDIS_URL=redis://127.0.0.1:6379
NEXT_PUBLIC_SITE_URL=https://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
CYBERDECK_HOME=/opt/cyberdeck
ENVEOF

mkdir -p "$STAGE_DIR/node_modules/@img" "$STAGE_DIR/node_modules/@next" "$STAGE_DIR/node_modules/@prisma" "$STAGE_DIR/node_modules/.prisma"
cp -a node_modules/@img/sharp-linux-arm64 "$STAGE_DIR/node_modules/@img/" || true
cp -a node_modules/@next/swc-linux-arm64-gnu "$STAGE_DIR/node_modules/@next/" || true
cp -a node_modules/node-pty "$STAGE_DIR/node_modules/" || true
cp -a node_modules/@prisma/client "$STAGE_DIR/node_modules/@prisma/" || true
cp -a node_modules/.prisma/client "$STAGE_DIR/node_modules/.prisma/" || true

echo "Build complete."
