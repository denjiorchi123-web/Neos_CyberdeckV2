# Yocto recipe — Pi 5 power / CPU-governor tuning for CyberDeck.
# Place at meta-cyberdeck/recipes-cyberdeck/power/cyberdeck-power.bb

SUMMARY = "CyberDeck Pi 5 power management (governor + RP1 tuning)"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck-power.service"

S = "${WORKDIR}"

RDEPENDS:${PN} = "ethtool"

inherit systemd
SYSTEMD_SERVICE:${PN}     = "cyberdeck-power.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${WORKDIR}/cyberdeck-power.service \
        ${D}${systemd_unitdir}/system/cyberdeck-power.service
}

FILES:${PN} = "${systemd_unitdir}/system/cyberdeck-power.service"
