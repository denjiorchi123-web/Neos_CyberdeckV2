#!/bin/bash
# Rebuilds the Next.js ARM64 app and replaces the tarball in meta-cyberdeck.
# Run from WSL: bash /mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/scripts/_rebuild-tarball.sh
set -euo pipefail

# ── Force Linux node/npm — never use Windows binaries from PATH ──────────────
# Strip Windows paths so Windows node.exe / npm.cmd are invisible inside WSL
export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v '/mnt/c/' | grep -v '/mnt/d/' | tr '\n' ':' | sed 's/:$//')

# Load nvm — must disable -u temporarily (nvm.sh uses unbound vars internally)
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  set +u
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use --lts 2>/dev/null || nvm use default 2>/dev/null || true
  set -u
fi

# Ensure a Linux node is present (install only if truly missing)
_node_ok() { command -v node &>/dev/null && [ "$(node -e 'process.platform' 2>/dev/null)" = "linux" ]; }
if ! _node_ok; then
  echo "[node] Linux Node.js not found — installing via nvm..."
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  set +u
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
  set -u
fi

NODE_BIN=$(command -v node)
NPM_BIN=$(command -v npm)
echo "[node] Using: $NODE_BIN ($(node --version))  npm: $(npm --version)"

PROJ="${PROJ:-/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS}"
YOCTO_ROOT="${YOCTO_ROOT:-$HOME/cyberdeck}"
LAYER="$YOCTO_ROOT/sources/meta-cyberdeck"
WORK=$HOME/cyberdeck-app-build
STAGE=$HOME/cyberdeck-app-stage
RECIPE_FILES="$LAYER/recipes-cyberdeck/cyberdeck-app/files"

echo "========================================"
echo "  CyberDeck ARM64 app rebuild"
echo "========================================"

# ── 1. Copy source tree ──────────────────────────────────────────────────────
echo "[1/6] Copying source from $PROJ..."
rm -rf "$WORK" && mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude .next \
  --exclude 'prisma/dev.db*' --exclude .git \
  --exclude private --exclude public/uploads \
  --exclude scratch --exclude '*.tsbuildinfo' \
  "$PROJ/" "$WORK/"
cd "$WORK"

# ── 2. npm install (host x64 — for next build to run) ────────────────────────
echo "[2/6] npm install..."
"$NPM_BIN" install --include=optional --no-audit --no-fund --loglevel=error 2>&1 | tail -5

# ── 3. Prisma generate (native + arm64 engines) ──────────────────────────────
echo "[3/6] prisma generate..."
"$NPM_BIN" exec -- prisma generate 2>&1 | tail -5

# ── 4. next build ─────────────────────────────────────────────────────────────
echo "[4/6] next build..."
"$NPM_BIN" run build 2>&1 | tail -10

# ── 5. Swap in ARM64 native binaries ─────────────────────────────────────────
echo "[5/6] Swapping in ARM64 binaries..."
"$NPM_BIN" install --no-save --include=optional --force \
  --cpu=arm64 --os=linux --libc=glibc \
  @img/sharp-linux-arm64 \
  @next/swc-linux-arm64-gnu \
  2>&1 | tail -5

# Stage the runtime tree
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -a .next/standalone/. "$STAGE/"
mkdir -p "$STAGE/.next"
cp -a .next/static "$STAGE/.next/"
cp -a public "$STAGE/" 2>/dev/null || true
cp -a prisma "$STAGE/"
cp -a backend "$STAGE/"
cp -a deploy "$STAGE/"
cp server.js "$STAGE/"

cat > "$STAGE/.env" << 'ENVEOF'
DATABASE_URL="file:./prisma/dev.db?journal_mode=WAL"
REDIS_URL=redis://127.0.0.1:6379
NEXT_PUBLIC_SITE_URL=https://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
CYBERDECK_HOME=/opt/cyberdeck
ENVEOF

mkdir -p "$STAGE/node_modules/@img" "$STAGE/node_modules/@next" \
         "$STAGE/node_modules/@prisma" "$STAGE/node_modules/.prisma"

# sharp arm64
[ -d node_modules/@img/sharp-linux-arm64 ]         && cp -a node_modules/@img/sharp-linux-arm64         "$STAGE/node_modules/@img/"
[ -d node_modules/@img/sharp-libvips-linux-arm64 ] && cp -a node_modules/@img/sharp-libvips-linux-arm64 "$STAGE/node_modules/@img/"
[ -d node_modules/sharp ]                           && cp -a node_modules/sharp                          "$STAGE/node_modules/"
# next-swc arm64
[ -d node_modules/@next/swc-linux-arm64-gnu ] && cp -a node_modules/@next/swc-linux-arm64-gnu "$STAGE/node_modules/@next/"
# prisma arm64
[ -d node_modules/@prisma/client ]  && cp -a node_modules/@prisma/client  "$STAGE/node_modules/@prisma/"
[ -d node_modules/.prisma/client ]  && cp -a node_modules/.prisma/client  "$STAGE/node_modules/.prisma/"
find "$STAGE/node_modules/.prisma/client" -name 'libquery_engine-*' ! -name '*linux-arm64*' -delete 2>/dev/null || true
# node-pty arm64
if [ -d node_modules/node-pty ]; then
  cp -a node_modules/node-pty "$STAGE/node_modules/"
  find "$STAGE/node_modules/node-pty/prebuilds" -mindepth 1 -maxdepth 1 ! -name 'linux-arm64' -exec rm -rf {} + 2>/dev/null || true
fi

# Strip x64-only binaries
rm -rf "$STAGE/node_modules/@next/swc-linux-x64-gnu" \
       "$STAGE/node_modules/@img/sharp-linux-x64" \
       "$STAGE/node_modules/@img/sharp-libvips-linux-x64" 2>/dev/null || true
find "$STAGE/node_modules" -type d -name 'darwin-*' -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE/node_modules" -type d -name 'win32-*'  -prune -exec rm -rf {} + 2>/dev/null || true

# ── 6. Package as tarball → recipe files dir ─────────────────────────────────
echo "[6/6] Creating tarball..."
TARBALL="cyberdeck-app-1.0.tar.gz"
cd "$HOME"
rm -f "$RECIPE_FILES/$TARBALL"
tar -czf "$RECIPE_FILES/$TARBALL" \
    --transform 's,^\./,cyberdeck-app-1.0/,' \
    -C "$STAGE" .

ls -lh "$RECIPE_FILES/$TARBALL"
echo ""
echo "========================================"
echo "  Tarball ready — run bitbake now"
echo "========================================"
