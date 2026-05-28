# CyberDeck Mesh Chat

Peer-to-peer LAN chat for two Windows laptops connected via direct ethernet cable.

## Quick setup

### 1. Network (both laptops)

| Laptop   | IP           |
|----------|--------------|
| Laptop-A | 192.168.1.1  |
| Laptop-B | 192.168.1.2  |

Subnet: `255.255.255.0` — leave Gateway and DNS blank.

### 2. Firewall (Administrator CMD on both)

```cmd
netsh advfirewall firewall add rule name="CyberDeck" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="CyberDeckSocket" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="CyberDeckDiscovery" dir=in action=allow protocol=UDP localport=3002
```

Verify: `ping 192.168.1.2` from A, `ping 192.168.1.1` from B.

### 3. Install and run

Copy this folder to `C:\cyberdeck` on both laptops (or run from this path).

**Laptop-A (easiest — double-click or Git Bash):**
```cmd
scripts\start-laptop-a.bat
```
```bash
bash scripts/start-laptop-a.sh
```

**Laptop-B (connects to Laptop-A at 192.168.1.1):**
```cmd
scripts\start-laptop-b.bat
```
```bash
bash scripts/start-laptop-b.sh
```

Manual setup:
```cmd
copy .env.laptop-a .env
npm install
node server.js
```

**Laptop-B:**
```cmd
copy .env.laptop-b .env
npm install
node server.js
```

### 4. Open browser (HTTPS)

- Laptop-A → **https://192.168.1.1:3000**
- Laptop-B → **https://192.168.1.2:3000**

The app uses **HTTPS** for the UI, API, and mesh socket links. On first visit the browser shows a security warning (self-signed LAN certificate). Click **Advanced** → **Proceed** (wording varies by browser).

Enter a username on each, click **Join Network**, pick the other user under **Contacts**, and chat.

## Features

- **HTTPS/WSS** for all browser and peer socket traffic
- UDP discovery + Socket.io mesh routing (Dijkstra)
- End-to-end encryption (tweetnacl / X25519)
- Offline outbox queue
- WhatsApp-style dark UI (single HTML file, no build step)

## Project layout

```
mesh-chat/
├── server.js
├── lib/          db, crypto, dijkstra, ssl
├── services/     discovery, heartbeat, router, outbox
└── public/       index.html
```
