SUMMARY = "CyberDeck nftables firewall"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck.nft file://nftables.service"

S = "${WORKDIR}"
RDEPENDS:${PN} = "nftables"

inherit systemd
SYSTEMD_SERVICE:${PN} = "nftables.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${sysconfdir}/nftables
    install -m 0644 ${WORKDIR}/cyberdeck.nft ${D}${sysconfdir}/nftables/cyberdeck.nft

    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${WORKDIR}/nftables.service ${D}${systemd_unitdir}/system/
}

FILES:${PN} = "${sysconfdir}/nftables/cyberdeck.nft ${systemd_unitdir}/system/nftables.service"
