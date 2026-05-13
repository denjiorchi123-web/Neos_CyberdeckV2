#!/bin/bash
set -e

# 5.1 layer.conf
cat > ~/cyberdeck/sources/meta-cyberdeck/conf/layer.conf << 'EOF'
BBPATH .= ":${LAYERDIR}"
BBFILES += "${LAYERDIR}/recipes-*/*/*.bb \
             ${LAYERDIR}/recipes-*/*/*.bbappend"
BBFILE_COLLECTIONS += "cyberdeck"
BBFILE_PATTERN_cyberdeck = "^${LAYERDIR}/"
BBFILE_PRIORITY_cyberdeck = "10"
LAYERDEPENDS_cyberdeck = "core raspberrypi security"
LAYERSERIES_COMPAT_cyberdeck = "scarthgap"
EOF

# 5.2 distro config
cat > ~/cyberdeck/sources/meta-cyberdeck/conf/distro/cyberdeck.conf << 'EOF'
DISTRO = "cyberdeck"
DISTRO_NAME = "CyberDeck OS"
DISTRO_VERSION = "1.0"
DISTRO_CODENAME = "nova"

require conf/distro/poky.conf

DISTRO_FEATURES:append = " wayland opengl pam ipv6 virtualization"
DISTRO_FEATURES:remove = " x11 bluetooth 3g nfc selinux"

SECURITY_CFLAGS = "-fstack-protector-strong -D_FORTIFY_SOURCE=2"
SECURITY_LDFLAGS = "-Wl,-z,relro,-z,now"

PACKAGE_CLASSES = "package_ipk"
EOF

# 5.3 machine config
cat > ~/cyberdeck/sources/meta-cyberdeck/conf/machine/cyberdeck-pi5.conf << 'EOF'
require conf/machine/raspberrypi5.conf

MACHINE_EXTRA_RRECOMMENDS += "kernel-modules"
MACHINE_FEATURES:remove = "wifi bluetooth"
MACHINE_FEATURES:append = " usbgadget usbhost"

SERIAL_CONSOLES = "115200;ttyAMA0 115200;ttyGS0"
CMDLINE:append = " ro quiet splash"
KERNEL_MODULE_AUTOLOAD += "sfp phylink dwc2 g_ether"
EOF

# 5.4 kernel hardening
cat > ~/cyberdeck/sources/meta-cyberdeck/recipes-kernel/linux/files/cyberdeck-hardening.cfg << 'EOF'
CONFIG_STRICT_KERNEL_RWX=y
CONFIG_STRICT_MODULE_RWX=y
CONFIG_RANDOMIZE_BASE=y
CONFIG_STACKPROTECTOR_STRONG=y
CONFIG_SLAB_FREELIST_RANDOM=y
CONFIG_SHUFFLE_PAGE_ALLOCATOR=y
CONFIG_KEXEC=n
CONFIG_HIBERNATION=n
CONFIG_PROC_KCORE=n
CONFIG_LEGACY_PTYS=n
CONFIG_BLUETOOTH=n
CONFIG_WIRELESS=n
CONFIG_CFG80211=n
CONFIG_USB_STORAGE=n
CONFIG_SYN_COOKIES=y
CONFIG_SFP=y
CONFIG_PHYLINK=y
CONFIG_USB=y
CONFIG_USB_XHCI_HCD=y
CONFIG_USB_GADGET=y
CONFIG_USB_ETH=y
CONFIG_USB_ETH_RNDIS=y
CONFIG_CRYPTO_AES=y
CONFIG_CRYPTO_GCM=y
CONFIG_CRYPTO_SHA256=y
CONFIG_CRYPTO_SHA512=y
CONFIG_HW_RANDOM=y
CONFIG_HW_RANDOM_BCM2835=y
CONFIG_NETDEVICES=y
CONFIG_ETHERNET=y
CONFIG_BCMGENET=y
CONFIG_PHYLIB=y
EOF

# 5.5 kernel bbappend
cat > ~/cyberdeck/sources/meta-cyberdeck/recipes-kernel/linux/linux-raspberrypi_%.bbappend << 'EOF'
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://cyberdeck-hardening.cfg"
EOF

# 5.6 wic partition layout
cat > ~/cyberdeck/sources/meta-cyberdeck/wic/cyberdeck-sdimage.wks << 'EOF'
part /boot --source bootimg-partition --ondisk mmcblk0 --fstype=vfat --label boot --active --align 4096 --size 256

part / --source rootfs --ondisk mmcblk0 --fstype=ext4 --label root --align 4096 --size 6144

part /data --ondisk mmcblk0 --fstype=ext4 --label data --align 4096 --size 2048

part /opt --ondisk mmcblk0 --fstype=ext4 --label opt --align 4096 --size 2048
EOF

# 5.7 main image recipe
cat > ~/cyberdeck/sources/meta-cyberdeck/recipes-core/images/cyberdeck-image.bb << 'IMAGEEOF'
SUMMARY = "CyberDeck OS - Defense-grade P2P communication node"
LICENSE = "MIT"

inherit core-image

IMAGE_FEATURES += "ssh-server-openssh"

IMAGE_INSTALL:append = " \
    openssh \
    openssh-sftp-server \
    nftables \
    avahi-daemon \
    avahi-utils \
    python3 \
    python3-pip \
    python3-asyncio \
    python3-json \
    python3-logging \
    curl \
    tmux \
    htop \
    e2fsprogs \
    util-linux \
    shadow \
    sudo \
    wayland \
    wayland-protocols \
    weston \
    weston-init \
    libinput \
    xkeyboard-config \
    nginx \
    foot \
    ttf-dejavu-sans \
    ttf-dejavu-sans-mono \
"

IMAGE_ROOTFS_SIZE ?= "4194304"
IMAGE_OVERHEAD_FACTOR ?= "1.5"

WKS_FILE = "cyberdeck-sdimage.wks"
IMAGE_FSTYPES += "wic wic.bz2"

ROOTFS_POSTPROCESS_COMMAND += "configure_sshd; configure_weston; configure_nginx; "

configure_sshd() {
    mkdir -p ${IMAGE_ROOTFS}/etc/ssh
    cat >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config << SSHCFG
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
SSHCFG
}

configure_weston() {
    mkdir -p ${IMAGE_ROOTFS}/etc/xdg/weston
    cat > ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini << WESTONCFG
[core]
backend=drm-backend.so
idle-time=0
require-input=false

[shell]
locking=false
panel-position=none

[autolaunch]
path=/usr/bin/cyberdeck-start.sh
WESTONCFG
    mkdir -p ${IMAGE_ROOTFS}/usr/bin
    cat > ${IMAGE_ROOTFS}/usr/bin/cyberdeck-start.sh << STARTCFG
#!/bin/sh
sleep 3
chromium \
    --ozone-platform=wayland \
    --kiosk \
    --no-sandbox \
    --disable-infobars \
    --disable-restore-session-state \
    --app=http://localhost:3000
STARTCFG
    chmod +x ${IMAGE_ROOTFS}/usr/bin/cyberdeck-start.sh
}

configure_nginx() {
    mkdir -p ${IMAGE_ROOTFS}/etc/nginx/conf.d
    cat > ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf << NGINXCFG
server {
    listen 3000;
    root /opt/cyberdeck/ui;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location /ws/ {
        proxy_pass http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINXCFG
}
IMAGEEOF

echo "=== Phase 5 ALL CONFIG FILES WRITTEN ==="
echo "--- layer.conf ---" && head -3 ~/cyberdeck/sources/meta-cyberdeck/conf/layer.conf
echo "--- distro ---" && head -3 ~/cyberdeck/sources/meta-cyberdeck/conf/distro/cyberdeck.conf
echo "--- machine ---" && head -3 ~/cyberdeck/sources/meta-cyberdeck/conf/machine/cyberdeck-pi5.conf
echo "--- image ---" && head -3 ~/cyberdeck/sources/meta-cyberdeck/recipes-core/images/cyberdeck-image.bb
