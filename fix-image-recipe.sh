#!/bin/bash
# Fix the image recipe - escape $ signs for bitbake and fix heredoc

cat > ~/cyberdeck/sources/meta-cyberdeck/recipes-core/images/cyberdeck-image.bb << 'RECIPEEOF'
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
    echo "PermitRootLogin prohibit-password" >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config
    echo "PasswordAuthentication no" >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config
    echo "PubkeyAuthentication yes" >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config
    echo "X11Forwarding no" >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config
    echo "MaxAuthTries 3" >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config
    echo "LoginGraceTime 30" >> ${IMAGE_ROOTFS}/etc/ssh/sshd_config
}

configure_weston() {
    mkdir -p ${IMAGE_ROOTFS}/etc/xdg/weston
    echo "[core]" > ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "backend=drm-backend.so" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "idle-time=0" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "require-input=false" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "[shell]" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "locking=false" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "panel-position=none" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "[autolaunch]" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini
    echo "path=/usr/bin/cyberdeck-start.sh" >> ${IMAGE_ROOTFS}/etc/xdg/weston/weston.ini

    mkdir -p ${IMAGE_ROOTFS}/usr/bin
    echo "#!/bin/sh" > ${IMAGE_ROOTFS}/usr/bin/cyberdeck-start.sh
    echo "sleep 3" >> ${IMAGE_ROOTFS}/usr/bin/cyberdeck-start.sh
    echo "chromium --ozone-platform=wayland --kiosk --no-sandbox --disable-infobars --disable-restore-session-state --app=http://localhost:3000" >> ${IMAGE_ROOTFS}/usr/bin/cyberdeck-start.sh
    chmod +x ${IMAGE_ROOTFS}/usr/bin/cyberdeck-start.sh
}

configure_nginx() {
    mkdir -p ${IMAGE_ROOTFS}/etc/nginx/conf.d
    echo "server {" > ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "    listen 3000;" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "    root /opt/cyberdeck/ui;" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "    index index.html;" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "    location / { try_files \$uri \$uri/ /index.html; }" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "    location /api/ { proxy_pass http://127.0.0.1:8000/; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection upgrade; }" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "    location /ws/ { proxy_pass http://127.0.0.1:8000/ws/; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection upgrade; }" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
    echo "}" >> ${IMAGE_ROOTFS}/etc/nginx/conf.d/cyberdeck.conf
}
RECIPEEOF

echo "=== Image recipe fixed ==="

# Re-run parse check
source ~/cyberdeck/sources/poky/oe-init-build-env ~/cyberdeck/build
bitbake cyberdeck-image -p 2>&1 | tail -8
