# Yocto recipe — batman-adv L2 mesh on eth0 + per-node identity from /data/node.conf.
#
# Place at meta-cyberdeck/recipes-cyberdeck/network/cyberdeck-network.bb
# with files/ alongside.
#
# Topology:
#   eth0  → raw mesh transport (no IP, no DHCP) — feeds batadv frames
#   bat0  → virtual L3 face of the mesh — holds 10.0.0.NN/24
#   usb0  → USB-C gadget ethernet (management plane, link-local /30)

SUMMARY = "CyberDeck batman-adv mesh + static identity"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://05-bat0.netdev \
           file://10-eth0-static.network \
           file://15-bat0.network \
           file://20-usb0-gadget.network \
           file://batman-adv-modload.conf \
           file://cyberdeck-identity.sh \
           file://cyberdeck-identity.service \
           file://cyberdeck-batadv-tune.service"

S = "${WORKDIR}"

# networkd is bundled into the `systemd` package on scarthgap, not split out.
RDEPENDS:${PN} = "systemd batctl kernel-module-batman-adv"

inherit systemd
SYSTEMD_SERVICE:${PN} = "cyberdeck-identity.service cyberdeck-batadv-tune.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    # systemd-networkd profiles
    install -d ${D}${sysconfdir}/systemd/network
    install -m 0644 ${WORKDIR}/05-bat0.netdev          ${D}${sysconfdir}/systemd/network/
    install -m 0644 ${WORKDIR}/10-eth0-static.network  ${D}${sysconfdir}/systemd/network/
    install -m 0644 ${WORKDIR}/15-bat0.network         ${D}${sysconfdir}/systemd/network/
    install -m 0644 ${WORKDIR}/20-usb0-gadget.network  ${D}${sysconfdir}/systemd/network/

    # modules-load.d entry so batman-adv loads at boot
    install -d ${D}${sysconfdir}/modules-load.d
    install -m 0644 ${WORKDIR}/batman-adv-modload.conf \
        ${D}${sysconfdir}/modules-load.d/batman-adv.conf

    # Identity binary
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/cyberdeck-identity.sh ${D}${bindir}/cyberdeck-identity

    # systemd units
    install -d ${D}${systemd_unitdir}/system
    install -m 0644 ${WORKDIR}/cyberdeck-identity.service    ${D}${systemd_unitdir}/system/
    install -m 0644 ${WORKDIR}/cyberdeck-batadv-tune.service ${D}${systemd_unitdir}/system/
}

FILES:${PN} = "${sysconfdir}/systemd/network/* \
               ${sysconfdir}/modules-load.d/batman-adv.conf \
               ${bindir}/cyberdeck-identity \
               ${systemd_unitdir}/system/cyberdeck-identity.service \
               ${systemd_unitdir}/system/cyberdeck-batadv-tune.service"
