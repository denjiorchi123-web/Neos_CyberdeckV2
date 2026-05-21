# CyberDeck Yocto recipe stub.
#
# Drop this into your meta-cyberdeck layer (e.g. meta-cyberdeck/recipes-cyberdeck/cyberdeck/).
# It packages the pre-built Next.js standalone output plus the Python sidecar and
# wires up the systemd services.
#
# Build prerequisites in your image (.bb):
#   IMAGE_INSTALL:append = " nodejs python3 python3-fastapi python3-uvicorn \
#                            python3-redis redis chromium openssl curl avahi-daemon \
#                            weston weston-init cyberdeck"
#
# Build the Next.js app on a workstation first (`npm ci && npm run build`) and
# stage the resulting tree (with .next/standalone, .next/static, public/, prisma/,
# backend/, deploy/, server.js, package.json, node_modules/.prisma, etc.) at
# files/cyberdeck-app/.

SUMMARY = "CyberDeck air-gapped LAN messenger"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck-app/"

S = "${WORKDIR}/cyberdeck-app"

inherit systemd

SYSTEMD_SERVICE:${PN} = "redis-cyberdeck.service \
                         cyberdeck-backend.service \
                         cyberdeck-web.service \
                         cyberdeck-kiosk.service \
                         cyberdeck-power.service"

SYSTEMD_AUTO_ENABLE:${PN} = "enable"

RDEPENDS:${PN} = "nodejs python3 python3-fastapi python3-uvicorn python3-redis \
                  redis openssl curl chromium-ozone-wayland weston weston-init avahi-daemon avahi-utils \
                  dhclient sudo"

FILES:${PN} = "/opt/cyberdeck \
               ${sysconfdir}/xdg/weston/weston.ini \
               ${sysconfdir}/udev/rules.d/99-cyberdeck-input.rules \
               ${sysconfdir}/udev/rules.d/98-usb-automount.rules \
               /usr/local/bin/usb-mount.sh \
               /usr/local/bin/usb-umount.sh \
               /usr/local/bin/cyberdeck-netconfig.sh \
               ${sysconfdir}/sudoers.d/99-cyberdeck \
               /media \
               /opt/cyberdeck/private \
               ${systemd_unitdir}/system/redis-cyberdeck.service \
               ${systemd_unitdir}/system/cyberdeck-backend.service \
               ${systemd_unitdir}/system/cyberdeck-web.service \
               ${systemd_unitdir}/system/cyberdeck-kiosk.service \
               ${systemd_unitdir}/system/getty@tty1.service.d/autologin.conf \
               ${sysconfdir}/avahi/services/cyberdeck.service"

do_install() {
    install -d ${D}/opt/cyberdeck
    cp -a ${S}/. ${D}/opt/cyberdeck/

    install -d ${D}${systemd_unitdir}/system
    for svc in ${D}/opt/cyberdeck/deploy/systemd/*.service; do
        install -m 0644 "$svc" ${D}${systemd_unitdir}/system/
    done

    # udev rules — input/DRM device access + USB automount
    install -d ${D}${sysconfdir}/udev/rules.d
    install -m 0644 ${D}/opt/cyberdeck/deploy/udev/99-cyberdeck-input.rules \
        ${D}${sysconfdir}/udev/rules.d/99-cyberdeck-input.rules
    install -m 0644 ${D}/opt/cyberdeck/deploy/udev/98-usb-automount.rules \
        ${D}${sysconfdir}/udev/rules.d/98-usb-automount.rules

    # USB mount/unmount helpers + network config helper — called by udev / sudo
    install -d ${D}/usr/local/bin
    install -m 0755 ${D}/opt/cyberdeck/deploy/scripts/usb-mount.sh \
        ${D}/usr/local/bin/usb-mount.sh
    install -m 0755 ${D}/opt/cyberdeck/deploy/scripts/usb-umount.sh \
        ${D}/usr/local/bin/usb-umount.sh
    install -m 0755 ${D}/opt/cyberdeck/deploy/scripts/cyberdeck-netconfig.sh \
        ${D}/usr/local/bin/cyberdeck-netconfig.sh

    # Sudoers fragment — lets the cyberdeck user run the two privileged helpers
    install -d ${D}${sysconfdir}/sudoers.d
    install -m 0440 ${D}/opt/cyberdeck/deploy/sudo/99-cyberdeck \
        ${D}${sysconfdir}/sudoers.d/99-cyberdeck

    # Mount base directory
    install -d ${D}/media

    # Weston config — kiosk-shell + autolaunch, all outputs (DSI + HDMI)
    install -d ${D}${sysconfdir}/xdg/weston
    install -m 0644 ${D}/opt/cyberdeck/deploy/yocto/snippets/weston.ini \
        ${D}${sysconfdir}/xdg/weston/weston.ini

    # Autologin on tty1 so the kiosk starts without a login prompt
    install -d ${D}${systemd_unitdir}/system/getty@tty1.service.d
    install -m 0644 ${D}/opt/cyberdeck/deploy/systemd/getty@tty1.service.d/autologin.conf \
        ${D}${systemd_unitdir}/system/getty@tty1.service.d/autologin.conf

    # Avahi service file — advertises this node on _cyberdeck._tcp
    install -d ${D}${sysconfdir}/avahi/services
    install -m 0644 ${D}/opt/cyberdeck/deploy/avahi/cyberdeck.service \
        ${D}${sysconfdir}/avahi/services/cyberdeck.service

    # Pre-create media and log directories so they exist even before first launch.
    # Next.js also calls ensureDirs() at runtime, but having them at install time
    # means the cyberdeck user can write to them immediately after first boot.
    install -d -m 0755 ${D}/opt/cyberdeck/private/uploads
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/photos
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/videos
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/audio
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/documents
    install -d -m 0755 ${D}/opt/cyberdeck/private/logs

    # Ensure the helper scripts are executable
    chmod 0755 ${D}/opt/cyberdeck/deploy/scripts/*.sh
}

pkg_postinst:${PN}() {
    # Create the kiosk user — NOT --system so it gets UID >= 1000 and a proper
    # XDG_RUNTIME_DIR under /run/user/<uid>. cage and systemd-logind require this.
    if ! getent passwd cyberdeck >/dev/null; then
        useradd --create-home --shell /bin/sh --uid 1000 cyberdeck
        usermod -aG video,audio,input,render,seat,i2c cyberdeck
    fi
    chown -R cyberdeck:cyberdeck /opt/cyberdeck
    # Allow node-pty to be rebuilt at first-boot if prebuilt is absent
    chmod 0755 /opt/cyberdeck/node_modules/node-pty 2>/dev/null || true

    # Boot straight into the kiosk: graphical.target is the parent of
    # cyberdeck-kiosk.service's WantedBy. Without this the image lands on
    # multi-user.target and weston never launches.
    if [ -d $D ]; then
        # Offline (image build) — write the symlink into the rootfs directly.
        ln -sf /lib/systemd/system/graphical.target \
            $D/etc/systemd/system/default.target
        # Disable getty on tty1 so weston can claim the VT without a fight.
        mkdir -p $D/etc/systemd/system
        ln -sf /dev/null $D/etc/systemd/system/getty@tty1.service
    else
        systemctl set-default graphical.target || true
        systemctl mask getty@tty1.service     || true
    fi
}
