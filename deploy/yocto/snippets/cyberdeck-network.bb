SUMMARY = "CyberDeck Networking"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://05-bat0.netdev \
           file://10-eth0.network \
           file://15-bat0.network \
           file://batman-adv-modload.conf \
           file://cyberdeck-identity.sh \
           file://cyberdeck-identity.service"

S = "${WORKDIR}"

RDEPENDS:${PN} = "systemd batctl kernel-module-batman-adv"

inherit systemd
SYSTEMD_SERVICE:${PN} = "cyberdeck-identity.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${sysconfdir}/systemd/network
    install -m 0644 ${WORKDIR}/05-bat0.netdev ${D}${sysconfdir}/systemd/network/
    install -m 0644 ${WORKDIR}/10-eth0.network ${D}${sysconfdir}/systemd/network/
    install -m 0644 ${WORKDIR}/15-bat0.network ${D}${sysconfdir}/systemd/network/

    install -d ${D}${sysconfdir}/modules-load.d
    install -m 0644 ${WORKDIR}/batman-adv-modload.conf ${D}${sysconfdir}/modules-load.d/batman-adv.conf

    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/cyberdeck-identity.sh ${D}${bindir}/cyberdeck-identity

    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${WORKDIR}/cyberdeck-identity.service ${D}${systemd_unitdir}/system/
}

FILES:${PN} = "${sysconfdir}/systemd/network/* \
               ${sysconfdir}/modules-load.d/batman-adv.conf \
               ${bindir}/cyberdeck-identity \
               ${systemd_unitdir}/system/cyberdeck-identity.service"
