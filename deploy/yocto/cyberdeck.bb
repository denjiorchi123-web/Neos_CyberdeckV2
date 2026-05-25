SUMMARY = "CyberDeck air-gapped LAN messenger"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck-app-1.0.tar.gz"
S = "${WORKDIR}/cyberdeck-app-1.0"

# Inherit useradd BEFORE systemd to ensure user context exists during package generation
inherit useradd systemd

# Pre-built Node.js native addons (.node files) are already-stripped ARM64 binaries.
# Prevent Yocto from trying to strip/objcopy them — it will fail on foreign-arch files.
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INHIBIT_SYSROOT_STRIP = "1"
INSANE_SKIP:${PN} = "already-stripped arch file-rdeps ldflags"

# Systemd configuration
SYSTEMD_SERVICE:${PN} = " \
    redis-cyberdeck.service \
    cyberdeck-backend.service \
    cyberdeck-web.service \
    cyberdeck-kiosk.service \
"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

# Declarative user creation
USERADD_PACKAGES = "${PN}"
GROUPADD_PARAM:${PN} = "-g 1200 cyberdeck ; -r render ; -r seat ; -r i2c"
USERADD_PARAM:${PN} = "--create-home --shell /bin/sh --uid 1200 --gid 1200 --groups video,audio,input,render,seat,i2c cyberdeck"

# NOTE: python3-fastapi / python3-uvicorn / python3-redis / dhclient / sudo are NOT
# available as Yocto packages in this layer set. Python deps are installed at first-boot
# via pip wheelhouse. Network and sudo tools are pulled in by the base image recipe.
RDEPENDS:${PN} = " \
    nodejs python3 \
    redis openssl curl chromium-ozone-wayland weston weston-init avahi-daemon avahi-utils \
"

FILES:${PN} = " \
    /opt/cyberdeck \
    ${sysconfdir}/cyberdeck-weston.ini \
    ${sysconfdir}/udev/rules.d/99-cyberdeck-input.rules \
    ${sysconfdir}/udev/rules.d/98-usb-automount.rules \
    /usr/local/bin/usb-mount.sh \
    /usr/local/bin/usb-umount.sh \
    /usr/local/bin/cyberdeck-netconfig.sh \
    ${sysconfdir}/sudoers.d/99-cyberdeck \
    /media \
    ${systemd_unitdir}/system/ \
    ${systemd_unitdir}/system/getty@tty1.service.d/autologin.conf \
    ${systemd_unitdir}/system/getty@tty2.service.d/autologin.conf \
    ${sysconfdir}/avahi/services/cyberdeck.service \
"

do_install() {
    # 1. Source tree to target rootfs
    install -d ${D}/opt/cyberdeck
    cp -a ${S}/. ${D}/opt/cyberdeck/

    # 2. Systemd services
    install -d ${D}${systemd_unitdir}/system/
    for svc in ${S}/deploy/systemd/*.service; do
        if [ "$(basename "$svc")" != "cyberdeck-power.service" ]; then
            install -m 0644 "$svc" ${D}${systemd_unitdir}/system/
        fi
    done

    # 3. Udev rules
    install -d ${D}${sysconfdir}/udev/rules.d
    install -m 0644 ${S}/deploy/udev/99-cyberdeck-input.rules \
        ${D}${sysconfdir}/udev/rules.d/99-cyberdeck-input.rules
    install -m 0644 ${S}/deploy/udev/98-usb-automount.rules \
        ${D}${sysconfdir}/udev/rules.d/98-usb-automount.rules

    # 4. Privileged helper scripts
    install -d ${D}/usr/local/bin
    install -m 0755 ${S}/deploy/scripts/usb-mount.sh \
        ${D}/usr/local/bin/usb-mount.sh
    install -m 0755 ${S}/deploy/scripts/usb-umount.sh \
        ${D}/usr/local/bin/usb-umount.sh
    install -m 0755 ${S}/deploy/scripts/cyberdeck-netconfig.sh \
        ${D}/usr/local/bin/cyberdeck-netconfig.sh

    # 5. Sudoers configuration
    install -d ${D}${sysconfdir}/sudoers.d
    install -m 0440 ${S}/deploy/sudo/99-cyberdeck \
        ${D}${sysconfdir}/sudoers.d/99-cyberdeck

    # 6. Global mount point
    install -d ${D}/media

    # 7. Weston config
    install -d ${D}${sysconfdir}
    install -m 0644 ${S}/deploy/yocto/snippets/weston.ini ${D}${sysconfdir}/cyberdeck-weston.ini

    # 8. Getty tty1 autologin override (Weston compositor owns tty1)
    install -d ${D}${systemd_unitdir}/system/getty@tty1.service.d
    install -m 0644 ${S}/deploy/systemd/getty@tty1.service.d/autologin.conf \
        ${D}${systemd_unitdir}/system/getty@tty1.service.d/autologin.conf

    # 8b. Getty tty2: dedicated root recovery shell (Ctrl+Alt+F2)
    #     Separate config from tty1 — scoped strictly to an interactive shell,
    #     completely isolated from the Weston graphical pipeline on tty1.
    install -d ${D}${systemd_unitdir}/system/getty@tty2.service.d
    if [ -f ${S}/deploy/systemd/getty@tty2.service.d/autologin.conf ]; then
        install -m 0644 ${S}/deploy/systemd/getty@tty2.service.d/autologin.conf \
            ${D}${systemd_unitdir}/system/getty@tty2.service.d/autologin.conf
    else
        cat > ${D}${systemd_unitdir}/system/getty@tty2.service.d/autologin.conf << 'EOFCONF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
EOFCONF
    fi

    # 9. Avahi mDNS network service advertising
    install -d ${D}${sysconfdir}/avahi/services
    install -m 0644 ${S}/deploy/avahi/cyberdeck.service \
        ${D}${sysconfdir}/avahi/services/cyberdeck.service

    # 10. Runtime storage paths
    install -d -m 0755 ${D}/opt/cyberdeck/private/uploads
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/photos
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/videos
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/audio
    install -d -m 0755 ${D}/opt/cyberdeck/private/media/documents
    install -d -m 0755 ${D}/opt/cyberdeck/private/logs

    # Correct runtime execution bits
    chmod 0755 ${D}/opt/cyberdeck/deploy/scripts/*.sh
    chmod 0755 ${D}/opt/cyberdeck/node_modules/node-pty 2>/dev/null || true

    # Deterministic ownership via numeric UID/GID — tracked correctly by pseudo
    # during offline rootfs construction. Matches USERADD_PARAM uid 1200.
    chown -R 1200:1200 ${D}/opt/cyberdeck
}

pkg_postinst:${PN}() {
    # Boot into graphical target by default
    mkdir -p $D${sysconfdir}/systemd/system
    ln -sf ${systemd_unitdir}/system/graphical.target \
        $D${sysconfdir}/systemd/system/default.target

    # Mask getty@tty1 — cyberdeck-kiosk.service owns tty1 via TTYPath=/dev/tty1
    ln -sf /dev/null $D${sysconfdir}/systemd/system/getty@tty1.service

    # Enable getty@tty2 for Ctrl+Alt+F2 recovery terminal (since default getty.target is suppressed)
    mkdir -p $D${sysconfdir}/systemd/system/getty.target.wants
    ln -sf ${systemd_unitdir}/system/getty@.service $D${sysconfdir}/systemd/system/getty.target.wants/getty@tty2.service

    # Mask upstream redis.service — redis-cyberdeck.service is the ONLY Redis instance.
    # Without this mask both services race for TCP port 6379 and crash each other.
    ln -sf /dev/null $D${sysconfdir}/systemd/system/redis.service
}
