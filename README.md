# CyberDeck — Air-Gapped LAN Messenger

A self-hosted, fully offline LAN messenger for trusted local networks. Designed
to boot in kiosk mode on a Raspberry Pi 5 running a custom Yocto image.

## Stack

- **Next.js 13** (App Router, custom HTTPS server in `server.js`)
- **Socket.io** for real-time chat, presence, WebRTC signaling
- **Prisma + SQLite** for local persistence (`prisma/dev.db`)
- **Redis** for presence, signaling state, and Socket.io pub/sub
- **FastAPI (Python)** sidecar in `backend/main.py` for status / dashboard
- **WebRTC** for 1:1 and group voice/video calls (peer-to-peer, no STUN/TURN required on a LAN)
- **bcryptjs** local auth (no Clerk, no cloud)

## Runtime Requirements (Pi 5 / Yocto image)

- `node` >= 18, `npm` >= 9
- `python3` with `fastapi`, `uvicorn`, `redis` packages
- `redis-server` (listening on 127.0.0.1:6379)
- `openssl` (for one-time cert generation)
- `chromium` (for kiosk mode)
- `sqlite3` (Prisma binary auto-targets `linux-arm64` — already in `node_modules` after `npm install` on the Pi)

## First boot

```bash
# 1. Install deps
npm install

# 2. Push DB schema
npm run db:push

# 3. Generate self-signed certs (only needs to run once)
mkdir -p ssl && npm run ssl:gen

# 4. Place font files in public/fonts/ (see deploy/README.md)

# 5. Build for production
npm run build

# 6. Start
npm run start
```

## Kiosk auto-launch

See `deploy/` for the systemd units, Chromium launcher, and Yocto integration
notes that make the app start fullscreen at boot.

## Available commands

| command       | description                                            |
| :------------ | :----------------------------------------------------- |
| `npm run dev` | Dev server with HTTPS at `https://localhost:3000`      |
| `npm run build` | Production build                                     |
| `npm run start` | Production server (clustered across all CPU cores) |
| `npm run db:push` | Generate Prisma client + push schema to SQLite   |
| `npm run ssl:gen` | Regenerate self-signed cert (CN=cyberdeck.local) |
