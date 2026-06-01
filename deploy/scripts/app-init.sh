#!/bin/sh
set -e

# Ensure mesh DB directory exists and is writable for persistence
mkdir -p /var/lib/mesh
chmod 777 /var/lib/mesh

cd /opt/cyberdeck

if [ ! -f ssl/server.cert ]; then
  mkdir -p ssl
  HOST=$(hostname)
  SAN="DNS:cyberdeck.local,DNS:${HOST}.local,DNS:*.local,DNS:localhost,IP:127.0.0.1,IP:10.0.0.1,IP:10.0.0.2,IP:10.0.0.3,IP:10.0.0.4"
  openssl req -x509 -newkey rsa:2048 -keyout ssl/server.key -out ssl/server.cert -days 3650 -nodes -subj "/CN=${HOST}.local" -addext "subjectAltName=$SAN"
  chmod 600 ssl/server.key
fi

if [ ! -f prisma/dev.db ]; then
  OPENSSL_VER=$(openssl version 2>/dev/null | awk '{print $2}' | cut -d. -f1,2 || echo "3.0")
  case "$OPENSSL_VER" in
    1.*) ENGINE_GLOB="*linux-arm64-openssl-1.1*" ;;
    *)   ENGINE_GLOB="*linux-arm64-openssl-3.0*" ;;
  esac
  ENGINE_FILE=$(find node_modules/.prisma/client -name "$ENGINE_GLOB" 2>/dev/null | head -n 1)
  if [ -n "$ENGINE_FILE" ] && [ ! -f node_modules/.prisma/client/libquery_engine-linux-arm64.so.node ]; then
    ln -sf "$(basename "$ENGINE_FILE")" node_modules/.prisma/client/libquery_engine-linux-arm64.so.node || true
  fi
  /usr/bin/node node_modules/.bin/prisma db push --skip-generate --accept-data-loss || true
fi
