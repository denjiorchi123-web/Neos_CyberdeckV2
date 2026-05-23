SUMMARY  = "CyberDeck Next.js app + FastAPI sidecar (prebuilt for linux-arm64)"
LICENSE  = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck-app-1.0.tar.gz \
           file://cyberdeck-web.service \
           file://cyberdeck-backend.service \
           file://redis-cyberdeck.service \
           file://cyberdeck-firstboot.service \
           file://cyberdeck-kiosk.service \
           file://first-boot.sh"

S = "${WORKDIR}/cyberdeck-app-1.0"

RDEPENDS:${PN} = "nodejs redis sqlite3 python3 python3-pip openssl bash sudo ethtool \
                  weston weston-init chromium-ozone-wayland"

inherit systemd
SYSTEMD_SERVICE:${PN} = "cyberdeck-firstboot.service redis-cyberdeck.service \
                          cyberdeck-backend.service cyberdeck-web.service \
                          cyberdeck-kiosk.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}/opt/cyberdeck
    cp -a ${S}/. ${D}/opt/cyberdeck/

    # Strip non-arm64 native binaries
    find ${D}/opt/cyberdeck/node_modules -type d -name 'linux-x64'   -prune -exec rm -rf {} + 2>/dev/null || true
    find ${D}/opt/cyberdeck/node_modules -type d -name 'darwin-*'    -prune -exec rm -rf {} + 2>/dev/null || true
    find ${D}/opt/cyberdeck/node_modules -type d -name 'win32-*'     -prune -exec rm -rf {} + 2>/dev/null || true
    find ${D}/opt/cyberdeck/node_modules/node-pty/prebuilds -mindepth 1 -maxdepth 1 \
        ! -name 'linux-arm64' -exec rm -rf {} + 2>/dev/null || true

    rm -f ${D}/opt/cyberdeck/prisma/dev.db* 2>/dev/null || true

    # Privileged helpers
    install -d ${D}/usr/local/bin
    install -m 0755 ${D}/opt/cyberdeck/deploy/scripts/cyberdeck-netconfig.sh \
        ${D}/usr/local/bin/cyberdeck-netconfig.sh
    install -m 0755 ${D}/opt/cyberdeck/deploy/scripts/usb-mount.sh \
        ${D}/usr/local/bin/usb-mount.sh
    install -m 0755 ${D}/opt/cyberdeck/deploy/scripts/usb-umount.sh \
        ${D}/usr/local/bin/usb-umount.sh

    # Sudoers fragment
    install -d ${D}${sysconfdir}/sudoers.d
    install -m 0440 ${D}/opt/cyberdeck/deploy/sudo/99-cyberdeck \
        ${D}${sysconfdir}/sudoers.d/99-cyberdeck

    # udev rules
    install -d ${D}${sysconfdir}/udev/rules.d
    install -m 0644 ${D}/opt/cyberdeck/deploy/udev/99-cyberdeck-input.rules \
        ${D}${sysconfdir}/udev/rules.d/
    install -m 0644 ${D}/opt/cyberdeck/deploy/udev/98-usb-automount.rules \
        ${D}${sysconfdir}/udev/rules.d/

    # (weston.ini is now provided via weston-init_%.bbappend to prevent clashes)

    # Avahi
    install -d ${D}${sysconfdir}/avahi/services
    install -m 0644 ${D}/opt/cyberdeck/deploy/avahi/cyberdeck.service \
        ${D}${sysconfdir}/avahi/services/cyberdeck.service

    # Writable dirs
    install -d ${D}/opt/cyberdeck/ssl
    install -d ${D}/opt/cyberdeck/private/uploads
    install -d ${D}/opt/cyberdeck/private/media/photos
    install -d ${D}/opt/cyberdeck/private/media/videos
    install -d ${D}/opt/cyberdeck/private/media/audio
    install -d ${D}/opt/cyberdeck/private/media/documents
    install -d ${D}/opt/cyberdeck/private/logs
    install -d ${D}/opt/cyberdeck/public/uploads

    # First-boot helper
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/first-boot.sh ${D}${bindir}/cyberdeck-first-boot

    # NOTE: getty@tty1 autologin removed — cyberdeck-kiosk.service binds
    # TTYPath=/dev/tty1 directly. Having both fight for tty1 caused weston
    # to fail with "could not take control of /dev/tty1".

    # systemd units
    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${WORKDIR}/redis-cyberdeck.service     ${D}${systemd_unitdir}/system/
    install -m 0644 ${WORKDIR}/cyberdeck-backend.service   ${D}${systemd_unitdir}/system/
    install -m 0644 ${WORKDIR}/cyberdeck-web.service       ${D}${systemd_unitdir}/system/
    install -m 0644 ${WORKDIR}/cyberdeck-firstboot.service ${D}${systemd_unitdir}/system/
    install -m 0644 ${WORKDIR}/cyberdeck-kiosk.service     ${D}${systemd_unitdir}/system/
}

pkg_postinst_ontarget:${PN}() {
    if ! getent passwd cyberdeck >/dev/null; then
        useradd --create-home --shell /bin/sh --uid 1000 cyberdeck
        usermod -aG video,audio,input,render,seat,i2c cyberdeck
    fi
    chown -R cyberdeck:cyberdeck /opt/cyberdeck
    chmod 0755 /opt/cyberdeck/node_modules/node-pty 2>/dev/null || true

    # Boot straight into the kiosk. graphical.target is the parent of
    # cyberdeck-kiosk.service's WantedBy=. Without this the image lands on
    # multi-user.target and weston never launches.
    systemctl set-default graphical.target || true
    # getty@tty1 fights weston for tty1 — mask it so weston wins.
    systemctl mask getty@tty1.service     || true
}

FILES:${PN} = "/opt/cyberdeck \
               /usr/local/bin/cyberdeck-netconfig.sh \
               /usr/local/bin/usb-mount.sh \
               /usr/local/bin/usb-umount.sh \
               ${sysconfdir}/sudoers.d/99-cyberdeck \
               ${sysconfdir}/udev/rules.d/99-cyberdeck-input.rules \
               ${sysconfdir}/udev/rules.d/98-usb-automount.rules \
               ${sysconfdir}/avahi/services/cyberdeck.service \
               ${bindir}/cyberdeck-first-boot \
               ${systemd_unitdir}/system/*.service"

INSANE_SKIP:${PN} += "already-stripped file-rdeps installed-vs-shipped ldflags textrel staticdev arch host-user-contaminated"

INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
