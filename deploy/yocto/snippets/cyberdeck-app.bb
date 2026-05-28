SUMMARY  = "CyberDeck Next.js app + FastAPI sidecar"
LICENSE  = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck-app-1.0.tar.gz"

S = "${WORKDIR}/cyberdeck-app-1.0"

RDEPENDS:${PN} = "nodejs redis sqlite3 python3 python3-pip python3-fastapi python3-uvicorn python3-redis openssl curl bash sudo ethtool weston weston-init chromium-ozone-wayland"

inherit systemd
SYSTEMD_SERVICE:${PN} = "redis-cyberdeck.service cyberdeck-backend.service cyberdeck-web.service cyberdeck-kiosk.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}/opt/cyberdeck
    cp -a ${S}/. ${D}/opt/cyberdeck/
    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${S}/deploy/systemd/*.service ${D}${systemd_unitdir}/system/
    
    install -d ${D}${sysconfdir}/systemd/system/getty@tty2.service.d
    install -m 0644 ${S}/deploy/systemd/getty@tty2.service.d/autologin.conf ${D}${sysconfdir}/systemd/system/getty@tty2.service.d/autologin.conf
    
    install -d ${D}${sysconfdir}/sudoers.d
    install -m 0440 ${S}/deploy/sudo/cyberdeck-time ${D}${sysconfdir}/sudoers.d/cyberdeck-time
    
    chmod +x ${D}/opt/cyberdeck/deploy/scripts/app-init.sh
    chmod +x ${D}/opt/cyberdeck/deploy/scripts/start-kiosk.sh
}

pkg_postinst:${PN}() {
    chown -R root:root $D/opt/cyberdeck
    if [ -n "$D" ]; then
        mkdir -p $D/etc/systemd/system
        ln -sf /lib/systemd/system/graphical.target $D/etc/systemd/system/default.target
        ln -sf /dev/null $D/etc/systemd/system/getty@tty1.service
    else
        systemctl set-default graphical.target || true
        systemctl mask getty@tty1.service || true
    fi
}

FILES:${PN} = "/opt/cyberdeck ${systemd_unitdir}/system/*.service ${sysconfdir}/systemd/system/getty@tty2.service.d/autologin.conf"

INSANE_SKIP:${PN} += "already-stripped file-rdeps installed-vs-shipped ldflags textrel staticdev arch host-user-contaminated"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
