SUMMARY  = "CyberDeck boot splash logos — firmware splash + Plymouth theme"
LICENSE  = "CLOSED"
LIC_FILES_CHKSUM = ""

SRC_URI = "file://boot-dark.png \
           file://boot-light.png \
           file://cyberdeck.plymouth \
           file://cyberdeck.script"

S = "${WORKDIR}"

RDEPENDS:${PN} = "plymouth"

do_install() {
    # ── Firmware splash (Pi firmware: filename is fixed to splash.png; we
    # also place a JPEG copy for users who switch to a custom bootloader.) ─
    install -d ${D}/boot
    install -m 0644 ${WORKDIR}/boot-dark.png ${D}/boot/splash.png

    # ── Plymouth theme (shown once kernel + initramfs are running) ──────
    # cyberdeck.script references Image("boot.jpeg") — must live in ImageDir
    THEME_DIR=${D}/usr/share/plymouth/themes/cyberdeck
    install -d ${THEME_DIR}
    install -m 0644 ${WORKDIR}/boot-dark.png       ${THEME_DIR}/boot.png
    install -m 0644 ${WORKDIR}/cyberdeck.plymouth  ${THEME_DIR}/cyberdeck.plymouth
    install -m 0644 ${WORKDIR}/cyberdeck.script    ${THEME_DIR}/cyberdeck.script
}

pkg_postinst:${PN}() {
    # Register as the active Plymouth theme
    plymouth-set-default-theme cyberdeck || true
}

FILES:${PN} = "/boot/splash.png \
               /usr/share/plymouth/themes/cyberdeck"
