# meta-cyberdeck — Yocto integration

Full instructions for baking a CyberDeck OS image for Raspberry Pi 5.

**Build host:** WSL Ubuntu 24.04 on an x86-64 Windows machine (or any x86-64 Linux).  
**Target:** Raspberry Pi 5 (aarch64, Yocto Scarthgap / 5.0).

---

## Directory layout

```
deploy/
├── yocto/
│   ├── cyberdeck.bb              ← main app recipe (drop into meta-cyberdeck)
│   ├── cyberdeck.wks             ← WIC partition layout
│   └── snippets/
│       ├── local.conf.inc        ← append to build/conf/local.conf
│       ├── cyberdeck-network.bb  ← batman-adv mesh recipe
│       ├── cyberdeck-firewall.bb ← nftables firewall recipe
│       ├── cyberdeck-bootlogo.bb ← Plymouth splash recipe
│       ├── cyberdeck-power.bb    ← Pi 5 power / CPU-governor recipe
│       └── ...
├── systemd/
│   ├── cyberdeck-web.service
│   ├── cyberdeck-backend.service
│   ├── redis-cyberdeck.service
│   ├── cyberdeck-kiosk.service
│   └── cyberdeck-power.service   ← governor + RP1 tuning (Pi 5 power fix)
└── scripts/
    ├── stage-all.sh              ← ONE-SHOT: build + stage everything
    ├── build-app-for-arm64.sh    ← Next.js ARM64 build
    ├── stage-meta-cyberdeck.sh   ← copies layer files into meta-cyberdeck
    └── stage-app-recipe.sh       ← creates Yocto recipe tarball
```

---

## 0. One-time host setup

Run once on the WSL Ubuntu 24.04 build host:

```bash
sudo apt update && sudo apt install -y \
  gawk wget git diffstat unzip texinfo gcc build-essential chrpath socat cpio \
  python3 python3-pip python3-pexpect xz-utils debianutils iputils-ping \
  python3-git python3-jinja2 python3-subunit zstd liblz4-tool file locales \
  libacl1 lz4

sudo locale-gen en_US.UTF-8

# Install Node 18 (for the Next.js ARM64 build step)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 1. Clone the Yocto stack

```bash
mkdir -p ~/cyberdeck && cd ~/cyberdeck

# Poky (Yocto 5.0 Scarthgap)
git clone -b scarthgap https://git.yoctoproject.org/poky sources/poky

# meta-openembedded (networking, python3, etc.)
git clone -b scarthgap https://github.com/openembedded/meta-openembedded sources/meta-openembedded

# Raspberry Pi BSP
git clone -b scarthgap https://github.com/agherzan/meta-raspberrypi sources/meta-raspberrypi

# CyberDeck layer (empty skeleton — files are staged by stage-all.sh)
mkdir -p sources/meta-cyberdeck/conf
cat > sources/meta-cyberdeck/conf/layer.conf << 'EOF'
BBPATH .= ":${LAYERDIR}"
BBFILES += "${LAYERDIR}/recipes-*/*/*.bb"
BBFILE_COLLECTIONS += "meta-cyberdeck"
BBFILE_PATTERN_meta-cyberdeck = "^${LAYERDIR}/"
BBFILE_PRIORITY_meta-cyberdeck = "10"
LAYERVERSION_meta-cyberdeck = "1"
LAYERSERIES_COMPAT_meta-cyberdeck = "scarthgap"
EOF
```

---

## 2. Initialise the build environment

```bash
cd ~/cyberdeck
source sources/poky/oe-init-build-env build

# Add layers (run from inside build/)
bitbake-layers add-layer ../sources/meta-openembedded/meta-oe
bitbake-layers add-layer ../sources/meta-openembedded/meta-python
bitbake-layers add-layer ../sources/meta-openembedded/meta-networking
bitbake-layers add-layer ../sources/meta-raspberrypi
bitbake-layers add-layer ../sources/meta-cyberdeck
```

---

## 3. Configure the build

Append to `build/conf/local.conf`:

```bash
cat >> conf/local.conf << 'EOF'

# CyberDeck OS config
require ${TOPDIR}/../sources/meta-cyberdeck/conf/local.conf.inc
EOF
```

Then copy the snippet:

```bash
mkdir -p ../sources/meta-cyberdeck/conf
cp /mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS/deploy/yocto/snippets/local.conf.inc \
   ../sources/meta-cyberdeck/conf/local.conf.inc
```

---

## 4. Stage the CyberDeck codebase into the layer

```bash
# From WSL, with the project mounted at /mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS
PROJ=/mnt/c/Users/brije/Downloads/CyberDeck_AirGappedOS
META=~/cyberdeck/sources/meta-cyberdeck

PROJ="$PROJ" META="$META" bash "$PROJ/deploy/scripts/stage-all.sh"
```

This runs the full pipeline:
1. Copies all recipe snippets (network, firewall, bootlogo, **power**) into `meta-cyberdeck`
2. Builds the Next.js app for ARM64 (swaps sharp / next-swc / prisma / node-pty binaries)
3. Packages the app into a tarball and writes `cyberdeck-app.bb`
4. Copies `cyberdeck.bb` into the layer

Expected output (abbreviated):

```
[1/4] Staging meta-cyberdeck layer files...
[ok] appended batman-adv kernel config
[ok] dropped network recipe
[ok] dropped firewall recipe
[ok] dropped bootlogo recipe
[ok] dropped power recipe
[ok] dropped batctl recipe

[2/4] Building Next.js app for ARM64...
[1/7] Copying source...
...
[7/7] Complete

[3/4] Creating Yocto recipe tarball...
[done] recipe + tarball + units written

[4/4] Installing cyberdeck.bb into layer...
Staging complete. You can now run bitbake.
```

---

## 5. Bake the image

```bash
cd ~/cyberdeck/build

# Full image bake (~2–4 hours on first run, <30 min on subsequent runs with sstate cache)
bitbake cyberdeck-image

# OR bake individual recipes to verify they parse cleanly first:
bitbake -p                    # parse only — catches syntax errors fast
bitbake cyberdeck-power       # power recipe alone
bitbake cyberdeck-network     # batman-adv recipe alone
bitbake cyberdeck             # main app recipe alone
bitbake cyberdeck-image       # full .wic image
```

The image lands at:

```
build/tmp/deploy/images/raspberrypi5/cyberdeck-image-raspberrypi5.wic.bz2
```

---

## 6. Flash the SD card

From WSL:

```bash
# Decompress
bunzip2 build/tmp/deploy/images/raspberrypi5/cyberdeck-image-raspberrypi5.wic.bz2

# Flash with bmaptool (fast, verifies blocks)
sudo bmaptool copy \
  build/tmp/deploy/images/raspberrypi5/cyberdeck-image-raspberrypi5.wic \
  /dev/sdX          # replace sdX with your SD card device

# OR with dd (slower, no verification)
sudo dd \
  if=build/tmp/deploy/images/raspberrypi5/cyberdeck-image-raspberrypi5.wic \
  of=/dev/sdX bs=4M status=progress conv=fsync
```

---

## 7. Per-node identity (one per SD card)

After flashing, mount the data partition and write the node ID:

```bash
sudo mkdir -p /mnt/cyberdata
sudo mount /dev/sdX4 /mnt/cyberdata       # partition 4 = /data

# Node 1
echo 'NODE_ID=01' | sudo tee /mnt/cyberdata/node.conf

# Node 2 (repeat on its card)
# echo 'NODE_ID=02' | sudo tee /mnt/cyberdata/node.conf

sudo umount /mnt/cyberdata
```

On first boot the Pi reads this and:
- Sets hostname → `deck-01`
- Assigns `bat0` IP → `10.0.0.1/24`
- Advertises mDNS as `deck-01.local`

---

## 8. Smoke test (after first boot)

SSH in (or use the kiosk terminal):

```bash
# Check services
systemctl status cyberdeck-power cyberdeck-web redis-cyberdeck cyberdeck-kiosk

# Verify power governor
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
# → schedutil

# Verify ARM boost / USB current
vcgencmd get_config usb_max_current_enable
vcgencmd get_throttled   # 0x0 = no throttling — power is good

# Verify batman-adv mesh
batctl o                 # originator table
ip addr show bat0        # should show 10.0.0.1/24

# Verify app
curl -k https://127.0.0.1:3000/api/network/status
curl -k https://127.0.0.1:3000/api/peers
```

---

## Pi 5 power requirements

| Supply | Result |
|--------|--------|
| 5V / 3A USB-C (15W) | Throttles under load — do NOT use |
| 5V / 5A USB-C PD (27W) | Full performance — **required** |
| Official Pi 5 PSU (27W) | Ideal |

`config.txt.append` sets:
- `usb_max_current_enable=1` — requests 5A from the USB PD supply
- `arm_boost=1` — unlocks 2.4 GHz turbo when power is adequate
- `dtparam=rp1_pwr=max` — keeps the RP1 south-bridge (USB/Ethernet) awake

`cyberdeck-power.service` sets:
- CPU governor → `schedutil` on all 4 cores
- Minimum CPU frequency → 1.5 GHz (prevents cold-start stutter)
- Deep C-states (C2/C3) disabled — removes ~300µs exit latency from audio/WebRTC
- `ethtool` disables wake-on-LAN and RX coalescing on eth0 — mesh frames processed immediately

---

## Networking topology

```
       ┌────────────────────────────────────────────────────┐
       │           batman-adv mesh (bat0, 10.0.0.x/24)     │
       └──┬──────────────┬──────────────┬──────────────┬───┘
      bat0│          bat0│          bat0│          bat0│
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │  deck-01  │  │  deck-02  │  │  deck-03  │  │  deck-04  │
    │   eth0    │══│   eth0    │══│   eth0    │══│   eth0    │
    └───────────┘  └───────────┘  └───────────┘  └───────────┘
              fiber / copper cables — any L2 topology
```

- `eth0` carries raw batadv frames — **no IP address**
- `bat0` is the L3 face — all app traffic uses this
- batman-adv handles routing, retransmission, and mesh resilience automatically

---

## Layer tree reference

```
meta-cyberdeck/
├── conf/
│   ├── layer.conf
│   └── local.conf.inc           ← IMAGE_INSTALL, MACHINE, DISTRO
├── recipes-cyberdeck/
│   ├── cyberdeck/
│   │   ├── cyberdeck.bb
│   │   └── files/cyberdeck-app-1.0.tar.gz   ← built by stage-all.sh
│   ├── network/
│   │   ├── cyberdeck-network.bb
│   │   └── files/   (bat0.netdev, eth0 config, identity scripts)
│   ├── firewall/
│   │   ├── cyberdeck-firewall.bb
│   │   └── files/   (cyberdeck.nft, nftables.service)
│   ├── bootlogo/
│   │   ├── cyberdeck-bootlogo.bb
│   │   └── files/   (boot-dark.jpeg, cyberdeck.plymouth, ...)
│   └── power/
│       ├── cyberdeck-power.bb
│       └── files/cyberdeck-power.service
├── recipes-kernel/
│   └── linux/
│       ├── linux-raspberrypi_%.bbappend
│       └── features/cyberdeck/
│           ├── no-radio.scc
│           └── no-radio.cfg
└── wic/
    └── cyberdeck.wks
```
