# CyberDeck — Roadmap of remaining UI work

These are features in your spec that aren't fully wired in the codebase yet.
Listed in rough order of build effort, smallest first.

## ✅ Done

- Air-gapped runtime (no Clerk / LiveKit / Google Fonts / UploadThing dependencies)
- HTTPS server with self-signed cert (regenerated at first boot, broad SANs for cross-Pi)
- WebRTC P2P voice/video, calls, busy signal, history (existing)
- FAT32-compatible streaming file upload (4 GiB cap, no RAM buffering)
- Model A peer discovery: mDNS + static fallback, launcher page
- Boot logos baked into Plymouth theme
- Kernel-level Wi-Fi/Bluetooth disable (Yocto fragment)
- Firmware-level Wi-Fi/Bluetooth disable (`config.txt` overlay)
- nftables LAN-only firewall (eth0 + usb0)
- Static IP per node from `/data/node.conf` (deck-01 → 10.0.0.1, etc.)
- Kiosk Chromium fullscreen with libinput touch
- systemd-networkd profiles for eth0 (LAN) + usb0 (gadget)

## 🟡 Partially done — needs backend work

### 1. In-UI terminal (xterm.js)

**Status:** `components/cyberdeck/terminal.tsx` exists but is a **mock**. It
only recognizes 5 hardcoded commands (`help`, `status`, `nodes`, `clear`,
`whoami`, `scan`) and returns canned text. No actual shell execution.

**What's needed:**
- Backend: add `node-pty` to spawn a real shell, expose via a WebSocket route
  (e.g., `/api/terminal/socket` upgrading to ws). Or shell out to `ssh
  localhost` if you want every terminal to go through OpenSSH for audit.
- Frontend: replace the `processCommand` switch with a passthrough to the
  WebSocket — every keystroke goes to the backend, every byte from the PTY
  comes back to xterm.
- Security: terminal must require an authenticated profile cookie. Restrict
  to the `cyberdeck` user (not root). systemd unit should run the WS upgrade
  handler with `CapabilityBoundingSet=` empty.

**Effort:** ~1 day. Touch-ready out of the box (xterm.js handles touch).

### 2. GUI file manager

**Status:** Not built. The chat already supports file sharing; this is a
separate Finder/Explorer-style view of `/data/files/` and uploads.

**What's needed:**
- Backend: `/api/fs/ls?path=...`, `/api/fs/download/...`, `/api/fs/upload`,
  `/api/fs/mkdir`, `/api/fs/rm`, `/api/fs/rename`. All scoped to a single
  jail (`/data/files`) — no traversal outside it. Strict path normalization.
- Frontend: new route `app/(main)/(routes)/files/page.tsx` with a tree view
  (left pane) + file grid (right pane). Drag-to-upload, click-to-download.
- Reuse the existing `EncryptedFileUpload` for the upload UX.

**Effort:** ~2 days.

### 3. Time / date settings page

**Status:** Not built. Pi has no RTC by default; clock is set by the user
manually until you add an RTC module.

**What's needed:**
- Backend: `/api/system/time GET` (read `date -u`), `/api/system/time PUT`
  (validate ISO 8601, call `timedatectl set-time <iso>` as root via a tiny
  setuid wrapper or polkit policy). Same for timezone via `timedatectl
  set-timezone`.
- Frontend: settings panel with a date/time picker + timezone dropdown.
- Yocto: ensure `tzdata` is in `IMAGE_INSTALL` (it is by default), and a
  polkit rule allows the `cyberdeck` user to call `timedatectl`.
- **Future RTC:** when you add a DS3231 or PCF8523 module, append
  `dtoverlay=i2c-rtc,ds3231` (or `pcf8523`) to `config.txt`, install
  `hwclock` (BusyBox provides), and let `systemd-timesyncd` skip — the RTC
  becomes the authoritative source.

**Effort:** ~half day.

### 4. Dashboard data — real metrics

**Status:** `components/cyberdeck/dashboard.tsx` calls
`http://localhost:8000/api/status` (FastAPI) which currently returns random
CPU/memory percentages. Node list works from Redis presence.

**What's needed:**
- FastAPI: read `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, eth0 RX/TX
  counters for real values.
- Fiber link health: SFP+ media converters often expose link status via
  ethtool (`ethtool eth0`). Parse `Link detected:` + speed.

**Effort:** ~half day.

## 🔴 Not started

### 5. Syncthing file sync between nodes

Your spec mentions Syncthing for P2P file sync. Not in the current image.

**What's needed:**
- Add `syncthing` to IMAGE_INSTALL.
- systemd unit running as the `cyberdeck` user.
- Pre-shared device IDs baked in (you can hardcode all 4 deck-XX device IDs
  in a `config.xml` template so they auto-trust each other at first boot).
- A "shared folder" rooted at `/data/syncthing/` mirrored across all nodes.

**Effort:** ~1 day.

### 6. Federated message mesh (Model B)

When you want every node to keep its own user DB and have messages sync
between them. Out of scope for the current Host/Join model — revisit after
the basic kit is running.

## Suggested next coding session

Pick from:
1. **Real terminal** — biggest user-facing improvement, smallest lift.
2. **GUI file manager** — independent of terminal; high value.
3. **Time/date settings** — quickest of the three, tests the polkit pattern
   you'll reuse for RTC later.

Tell me which to do next and I'll build it.
