# CyberDeck — Pi 5 / Yocto Deployment

Files in this directory build a kiosk image: on power-on, the Pi 5 boots straight
into Chromium fullscreen pointed at the local CyberDeck server. There is no
desktop, no login screen, no other UI — just the app.

## Topology — Host/Join over a LAN cable

Every Pi runs the full stack (Next.js + Redis + FastAPI + SQLite). A direct
LAN cable between two Pis is all that's needed — no router, no Wi-Fi, no radio.

On boot, the kiosk lands on `/launcher`:

- **Use this device** → keeps the kiosk on `https://localhost:3000`. This Pi is the host; everyone you chat with joins this instance.
- **Discovered peers** → mDNS-discovered (and statically configured) CyberDeck nodes on the LAN. Pick one and the kiosk navigates to `https://<peer>.local:3000/launcher` — you're now using that Pi's stack.

Peer discovery uses **mDNS first, static fallback second**:

- mDNS: `avahi-daemon` advertises `_cyberdeck._tcp` on port 3000. The launcher runs `avahi-browse` to enumerate live nodes.
- Static: `/opt/cyberdeck/peers.json` (seeded from `config/peers.json.example`). Edit this file to hardcode IPs for nodes that should always show up even if avahi is down.

WebRTC voice/video calls between two Pis stay peer-to-peer over the cable — they don't transit any server, even when one Pi is "hosting" the chat session.

```
deploy/
├── systemd/
│   ├── redis-cyberdeck.service       # local Redis (loopback only)
│   ├── cyberdeck-backend.service     # FastAPI sidecar on :8000
│   ├── cyberdeck-web.service         # Next.js HTTPS server on :3000
│   ├── cyberdeck-kiosk.service       # Chromium kiosk
│   └── getty@tty1.service.d/
│       └── autologin.conf            # passwordless tty1 login for kiosk user
├── scripts/
│   ├── first-boot-ssl.sh             # generates self-signed cert if missing
│   ├── wait-for-web.sh               # blocks until :3000 is up
│   ├── start-kiosk.sh                # Chromium launch flags
│   ├── cyberdeck-netconfig.sh        # privileged network config helper (sudo)
│   ├── usb-mount.sh / usb-umount.sh  # USB automount helpers
│   ├── install.sh                    # manual installer for non-Yocto Pi OS
│   ├── build-app-for-arm64.sh        # WSL build + arm64 binary swap
│   ├── stage-app-tree.sh             # final staging of runtime tree
│   ├── stage-app-recipe.sh           # writes Yocto recipe + tarball
│   └── stage-meta-cyberdeck.sh       # copies layer files into meta-cyberdeck
├── sudo/
│   └── 99-cyberdeck                  # sudoers fragment for privileged helpers
├── udev/
│   ├── 99-cyberdeck-input.rules      # input/DRM device ACLs
│   └── 98-usb-automount.rules        # USB automount trigger
├── avahi/
│   └── cyberdeck.service             # mDNS service advertisement
└── yocto/
    ├── cyberdeck.bb                  # main Yocto recipe stub
    ├── cyberdeck.wks                 # partition layout (WIC)
    └── snippets/
        ├── local.conf.inc            # append to Yocto conf/local.conf
        ├── cyberdeck-network.bb      # batman-adv mesh recipe
        ├── cyberdeck-firewall.bb     # nftables firewall recipe
        ├── cyberdeck-bootlogo.bb     # Plymouth splash recipe
        └── ...                       # network configs, systemd units
```

## Service dependency chain

```
network.target
    └─> redis-cyberdeck.service
            ├─> cyberdeck-backend.service   (FastAPI)
            └─> cyberdeck-web.service       (Next.js + Socket.io)
                    └─> cyberdeck-kiosk.service   (Chromium)
```

## Features

### Chat
- Text messaging with delivery status (sent / delivered / read)
- **Media messages**: inline image viewer with fullscreen lightbox, video player with poster thumbnail, audio messages with 28-bar waveform player, document downloads with type badge
- Emoji reactions, message editing, delete
- Offline queue — messages sent while disconnected are delivered when the socket reconnects

### Voice & Video calls
- WebRTC peer-to-peer (no TURN, no relay — works directly over the fiber cable)
- Full-duplex audio + video, mute/camera-off controls, fullscreen

### File sharing
- Encrypted upload to `/opt/cyberdeck/private/uploads/`
- Per-user media key for E2E-encrypted file storage
- USB drive automount + file manager (`/files` route)

### Terminal emulator
- In-browser shell via `node-pty` — full PTY over Socket.io
- ARM64 native addon; prebuilt included in the staged tree under `node_modules/node-pty/prebuilds/linux-arm64/`

### Node status (real-time)
- CPU idle%, memory used/total, uptime ticker (live 1s), hostname
- Polled from `/api/network/status` — isolated `LiveUptime` component prevents full-page re-renders

### Interface configuration
- View all network adapters with MAC, IP, prefix, gateway, up/down state
- Toggle **DHCP** (auto) ↔ **Static IP** per interface
- DHCP applies immediately via `networkctl reload` (systemd-networkd) or `dhclient`/`udhcpc` fallback
- Static applies via `ip addr add` + `networkctl reload`
- All changes go through the privileged helper `cyberdeck-netconfig.sh` via sudo
- Add new virtual ethernet ports from the UI

### Profile management
- Edit display name, email, avatar (upload from USB or camera)
- Change password (PBKDF2-SHA512 with userId salt)
- Delete account (two-step confirmation)
- Accessible via the user icon in the navigation sidebar → `/profile`

## Required image packages (Yocto)

`deploy/yocto/snippets/local.conf.inc` covers this. Key additions versus a
minimal Yocto image:

```
IMAGE_INSTALL:append = " \
    nodejs nodejs-npm \
    python3 python3-fastapi python3-uvicorn python3-redis \
    redis sqlite3 \
    openssl curl \
    chromium-x11 \
    weston weston-init \
    avahi-daemon avahi-utils \
    nftables openssh \
    batctl iproute2 dhclient \
    kernel-module-batman-adv \
    cyberdeck cyberdeck-firewall cyberdeck-network cyberdeck-bootlogo \
"
```

`dhclient` is required for the DHCP fallback path when systemd-networkd is not
running. `sudo` is required for `cyberdeck-netconfig.sh`.

## Network config helper

`deploy/scripts/cyberdeck-netconfig.sh` is a privileged POSIX shell script
installed at `/usr/local/bin/cyberdeck-netconfig.sh`. It is the only entry
point that runs as root.

Interface whitelist: `bat0 eth0 usb0 eth1 eth2 enp1s0 enp2s0 enp3s0 wlan0`

```bash
# DHCP
sudo cyberdeck-netconfig.sh eth0 dhcp

# Static
sudo cyberdeck-netconfig.sh eth0 192.168.1.10 24 192.168.1.1
```

The sudoers fragment `deploy/sudo/99-cyberdeck` grants the `cyberdeck` user
passwordless access to this script only.

## ARM64 build pipeline

Run on WSL Ubuntu 24.04 (or any x86-64 Linux with Node 18+):

```bash
# 1) Build + swap arm64 binaries
bash deploy/scripts/build-app-for-arm64.sh

# 2) Stage meta-cyberdeck layer files
META=~/cyberdeck/sources/meta-cyberdeck bash deploy/scripts/stage-meta-cyberdeck.sh

# 3) Create Yocto recipe tarball
bash deploy/scripts/stage-app-recipe.sh
```

Native modules requiring ARM64 prebuilts:
| Module | Mechanism |
|--------|-----------|
| `@img/sharp-linux-arm64` | `npm install --cpu=arm64 --os=linux` |
| `@next/swc-linux-arm64-gnu` | same |
| `node-pty` | prebuilds/linux-arm64/ bundled in the npm package |
| `prisma` | `binaryTargets` in schema.prisma generates both |

## Fonts (air-gapped requirement)

`app/layout.tsx` no longer pulls fonts from Google. Place these in
`public/fonts/` **before running `npm run build`**:

- `OpenSans-Regular.woff2`
- `OpenSans-Bold.woff2`
- `ShareTechMono-Regular.woff2`

## Manual install on Raspberry Pi OS (without Yocto)

```bash
# On a workstation:
git clone <this-repo> cyberdeck && cd cyberdeck
npm ci && npm run build

# Stage and copy to Pi:
rsync -a --exclude node_modules --exclude .next/cache ./ pi@cyberdeck.local:/opt/cyberdeck-staging/

# On the Pi:
sudo /opt/cyberdeck-staging/deploy/scripts/install.sh
sudo systemctl reboot
```

## First-boot

`cyberdeck-firstboot.service` runs once (guarded by `/opt/cyberdeck/.firstboot-done`):

1. Generates a 10-year self-signed TLS cert with SANs for all local IPs + `cyberdeck.local`
2. Installs Python deps from the offline wheelhouse at `/opt/cyberdeck/wheels/`
3. Pushes the Prisma schema → `prisma/dev.db` (creates all tables)
4. Checks node-pty ARM64 prebuilt; rebuilds from source if the prebuilt is missing

## Smoke test (after install, before reboot)

```bash
sudo systemctl start redis-cyberdeck cyberdeck-backend cyberdeck-web
sleep 5
curl -k https://127.0.0.1:3000/launcher          # launcher HTML
curl -k https://127.0.0.1:3000/api/peers          # { self, peers }
curl -k https://127.0.0.1:3000/api/network        # interface list (JSON)
curl -k https://127.0.0.1:3000/api/network/status # CPU/mem/uptime (JSON)
curl http://127.0.0.1:8000/api/status             # FastAPI backend status

# Confirm mDNS
avahi-browse -t -r _cyberdeck._tcp

sudo systemctl start cyberdeck-kiosk              # Chromium fullscreen
```

## Two-Pi cable bring-up

1. Flash the image to both Pis.
2. Connect with a single Ethernet cable (Pi 5 has auto-MDIX — no crossover needed).
3. Power on. batman-adv brings up `bat0` at `10.0.0.NN/24` (NN from `/data/node.conf`). The `/me` page shows the live interface state.
4. Either kiosk's `/launcher` shows the other node within ~5 seconds via mDNS. Pick one to host.
5. If avahi fails, edit `/opt/cyberdeck/peers.json` on each Pi with the other's IP.

## What this does NOT do

- No OTA updates — by design (air-gapped).
- No NTP — timestamps assume a working RTC or LAN-local NTP.
- No firewall rules beyond the bundled `cyberdeck-firewall` recipe (nftables drops everything except tcp/3000, udp/ephemeral for WebRTC, and mDNS/avahi on the LAN interface).
