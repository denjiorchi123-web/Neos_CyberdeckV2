# Yocto recipe — install nftables rules that allow ONLY LAN traffic.
# Drop everything that isn't on the 10.0.0.0/24 fiber LAN, ssh from usb0, or
# loopback. WiFi / Bluetooth are gone at kernel level; this is a second wall.
#
# Place at meta-cyberdeck/recipes-cyberdeck/firewall/cyberdeck-firewall.bb
# with files/cyberdeck.nft alongside.

SUMMARY  = "CyberDeck nftables firewall (LAN-only)"
LICENSE  = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck.nft \
           file://nftables.service"

S = "${WORKDIR}"

RDEPENDS:${PN} = "nftables"

inherit systemd
SYSTEMD_SERVICE:${PN} = "nftables.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${sysconfdir}/nftables
    install -m 0644 ${WORKDIR}/cyberdeck.nft ${D}${sysconfdir}/nftables/cyberdeck.nft

    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${WORKDIR}/nftables.service ${D}${systemd_unitdir}/system/nftables.service
}

FILES:${PN} = "${sysconfdir}/nftables/cyberdeck.nft \
               ${systemd_unitdir}/system/nftables.service"
