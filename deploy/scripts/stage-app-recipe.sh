#!/bin/bash
# Tarball the staged app tree and create the cyberdeck-app Yocto recipe
# plus its systemd unit files and first-boot helper.
set -euo pipefail

STAGE="$HOME/cyberdeck-app-stage"
META="${META:-$HOME/cyberdeck/sources/meta-cyberdeck}"
RECIPE_DIR="$META/recipes-cyberdeck/cyberdeck-app"
FILES_DIR="$RECIPE_DIR/files"
TARBALL="cyberdeck-app-1.0.tar.gz"

if [ ! -d "$STAGE" ]; then
  echo "ERROR: $STAGE missing — run build-app-for-arm64.sh first" >&2
  exit 1
fi

mkdir -p "$FILES_DIR"

# ─── 1. Tarball the runtime tree ──────────────────────────────────────
echo "[1/3] Creating $TARBALL..."
cd "$HOME"
rm -f "$FILES_DIR/$TARBALL"
# Wrap with a top-level dir name "cyberdeck-app-1.0" for clean extraction
tar -czf "$FILES_DIR/$TARBALL" --transform 's,^\./,cyberdeck-app-1.0/,' -C "$STAGE" .
ls -lh "$FILES_DIR/$TARBALL"

# ─── 2. systemd units + first-boot helper ─────────────────────────────
echo "[2/3] Writing systemd units + first-boot script..."

cat > "$FILES_DIR/redis-cyberdeck.service" <<'EOF'
[Unit]
Description=CyberDeck Redis (presence + signaling state)
After=network.target
Before=cyberdeck-web.service cyberdeck-backend.service

[Service]
Type=simple
ExecStart=/usr/bin/redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

cat > "$FILES_DIR/cyberdeck-backend.service" <<'EOF'
[Unit]
Description=CyberDeck FastAPI Backend (status / dashboard)
After=network.target redis-cyberdeck.service cyberdeck-firstboot.service
Requires=redis-cyberdeck.service
Wants=cyberdeck-firstboot.service

[Service]
Type=simple
WorkingDirectory=/opt/cyberdeck/backend
Environment=REDIS_URL=redis://127.0.0.1:6379
Environment=PATH=/opt/cyberdeck/wheels/bin:/usr/bin:/bin
ExecStart=/usr/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$FILES_DIR/cyberdeck-web.service" <<'EOF'
[Unit]
Description=CyberDeck Web (Next.js + Socket.io)
After=network.target redis-cyberdeck.service cyberdeck-backend.service cyberdeck-firstboot.service
Requires=redis-cyberdeck.service
Wants=cyberdeck-firstboot.service avahi-daemon.service

[Service]
Type=simple
WorkingDirectory=/opt/cyberdeck
EnvironmentFile=-/opt/cyberdeck/.env
Environment=NODE_ENV=production
Environment=CYBERDECK_PEERS_FILE=/opt/cyberdeck/peers.json
# Ensure SSL certs exist (fallback if firstboot didn't run or failed)
ExecStartPre=/bin/sh -c 'if [ ! -f /opt/cyberdeck/ssl/server.cert ]; then mkdir -p /opt/cyberdeck/ssl && openssl req -x509 -newkey rsa:2048 -keyout /opt/cyberdeck/ssl/server.key -out /opt/cyberdeck/ssl/server.cert -days 3650 -nodes -subj "/CN=cyberdeck.local" -addext "subjectAltName=DNS:cyberdeck.local,DNS:*.local,DNS:localhost,IP:127.0.0.1" && chmod 600 /opt/cyberdeck/ssl/server.key; fi'
ExecStart=/usr/bin/node /opt/cyberdeck/server.js
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$FILES_DIR/cyberdeck-firstboot.service" <<'EOF'
[Unit]
Description=CyberDeck first-boot setup (SSL cert + DB schema + pip wheelhouse)
After=local-fs.target
Before=cyberdeck-web.service cyberdeck-backend.service
ConditionPathExists=!/opt/cyberdeck/.firstboot-done

[Service]
Type=oneshot
RemainAfterExit=yes
# Hard timeout — firstboot must not block boot for more than 2 minutes
TimeoutStartSec=120
ExecStart=/usr/bin/cyberdeck-first-boot

[Install]
WantedBy=multi-user.target
EOF

cat > "$FILES_DIR/first-boot.sh" <<'EOF'
#!/bin/sh
# Runs once on first boot. Idempotent — guarded by /opt/cyberdeck/.firstboot-done.
set -eu

DONE=/opt/cyberdeck/.firstboot-done
[ -f "$DONE" ] && exit 0

cd /opt/cyberdeck

# 1) Self-signed cert
if [ ! -f ssl/server.cert ] || [ ! -f ssl/server.key ]; then
  echo "[firstboot] generating TLS cert"
  mkdir -p ssl
  HOST=$(hostname)
  SAN="DNS:cyberdeck.local,DNS:${HOST}.local,DNS:*.local,DNS:localhost,IP:127.0.0.1"
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in 127.*|::1|fe80:*) continue;; esac
    SAN="$SAN,IP:$ip"
  done
  SAN="$SAN,IP:10.0.0.1,IP:10.0.0.2,IP:10.0.0.3,IP:10.0.0.4"
  openssl req -x509 -newkey rsa:2048 \
    -keyout ssl/server.key -out ssl/server.cert \
    -days 3650 -nodes \
    -subj "/CN=${HOST}.local" \
    -addext "subjectAltName=$SAN"
  chmod 600 ssl/server.key
fi

# 2) Pip install fastapi + uvicorn from offline wheelhouse
if [ -d /opt/cyberdeck/wheels ]; then
  echo "[firstboot] installing python deps from wheelhouse"
  pip3 install --no-index --find-links /opt/cyberdeck/wheels --target /opt/cyberdeck/wheels/lib \
    --break-system-packages fastapi uvicorn 2>&1 | tail -5 || true
  # Make uvicorn discoverable via PATH
  if [ -f /opt/cyberdeck/wheels/lib/bin/uvicorn ]; then
    mkdir -p /opt/cyberdeck/wheels/bin
    ln -sf /opt/cyberdeck/wheels/lib/bin/uvicorn /opt/cyberdeck/wheels/bin/uvicorn
  fi
fi

# 3) Push Prisma schema → SQLite (creates dev.db with all tables)
if [ ! -f prisma/dev.db ]; then
  echo "[firstboot] pushing Prisma schema"
  cd /opt/cyberdeck
  # Select the correct Prisma engine for the installed OpenSSL version
  OPENSSL_VER=$(openssl version 2>/dev/null | awk '{print $2}' | cut -d. -f1,2 || echo "3.0")
  case "$OPENSSL_VER" in
    1.*) ENGINE_GLOB="*linux-arm64-openssl-1.1*" ;;
    *)   ENGINE_GLOB="*linux-arm64-openssl-3.0*" ;;
  esac
  # Symlink the matching engine so prisma client can find it
  ENGINE_FILE=$(find node_modules/.prisma/client -name "$ENGINE_GLOB" 2>/dev/null | head -1)
  if [ -n "$ENGINE_FILE" ] && [ ! -f node_modules/.prisma/client/libquery_engine-linux-arm64.so.node ]; then
    ln -sf "$(basename "$ENGINE_FILE")" node_modules/.prisma/client/libquery_engine-linux-arm64.so.node 2>/dev/null || true
  fi
  if [ -f node_modules/.bin/prisma ]; then
    /usr/bin/node node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>&1 | tail -5 || true
  fi
fi

# 4) Verify node-pty native addon — rebuild from source if prebuilt missing
if [ -d /opt/cyberdeck/node_modules/node-pty ]; then
  NPTY_PREBUILD="/opt/cyberdeck/node_modules/node-pty/prebuilds/linux-arm64"
  if [ ! -f "${NPTY_PREBUILD}/node.napi.node" ]; then
    echo "[firstboot] node-pty prebuilt missing — attempting rebuild"
    cd /opt/cyberdeck/node_modules/node-pty
    /usr/bin/node /usr/bin/npm rebuild 2>&1 | tail -5 || \
      echo "[firstboot] WARNING: node-pty rebuild failed — terminal feature unavailable" >&2
    cd /opt/cyberdeck
  else
    echo "[firstboot] node-pty ARM64 prebuild OK"
  fi
fi

touch "$DONE"
echo "[firstboot] complete"
EOF
chmod +x "$FILES_DIR/first-boot.sh"

# Copy the extra systemd unit files from deploy/systemd that aren't generated here
cp "/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/systemd/cyberdeck-kiosk.service" "$FILES_DIR/"

# ─── 3. Recipe ───────────────────────────────────────────────────────
echo "[3/3] Writing cyberdeck-app.bb..."
cp "/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/yocto/snippets/cyberdeck-app.bb" "$RECIPE_DIR/cyberdeck-app.bb"

echo "[done] recipe + tarball + units written"
ls -la "$RECIPE_DIR/" "$FILES_DIR/"
