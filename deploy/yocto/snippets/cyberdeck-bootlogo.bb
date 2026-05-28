SUMMARY  = "CyberDeck boot splash logos — firmware splash + Plymouth theme"
LICENSE  = "CLOSED"
LIC_FILES_CHKSUM = ""

SRC_URI = "file://boot logo.png \
           file://cyberdeck.plymouth \
           file://cyberdeck.script"

S = "${WORKDIR}"

RDEPENDS:${PN} = "plymouth"

do_install() {
    # ── Firmware splash (Pi firmware: filename is fixed to splash.png) ─
    install -d ${D}/boot
    install -m 0644 "${WORKDIR}/boot logo.png" ${D}/boot/splash.png

    # ── Plymouth theme ──────
    THEME_DIR=${D}/usr/share/plymouth/themes/cyberdeck
    install -d ${THEME_DIR}
    install -m 0644 "${WORKDIR}/boot logo.png"       ${THEME_DIR}/boot.png
    install -m 0644 ${WORKDIR}/cyberdeck.plymouth  ${THEME_DIR}/cyberdeck.plymouth
    install -m 0644 ${WORKDIR}/cyberdeck.script    ${THEME_DIR}/cyberdeck.script
}

pkg_postinst:${PN}() {
    # Register as the active Plymouth theme
    plymouth-set-default-theme cyberdeck || true
}

FILES:${PN} = "/boot/splash.png \
               /usr/share/plymouth/themes/cyberdeck"
