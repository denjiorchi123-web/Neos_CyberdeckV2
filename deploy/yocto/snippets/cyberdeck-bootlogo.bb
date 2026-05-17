SUMMARY  = "CyberDeck boot splash logos — firmware splash + Plymouth theme"
LICENSE  = "CLOSED"
LIC_FILES_CHKSUM = ""

SRC_URI = "file://boot-dark.jpeg \
           file://boot-light.jpeg"

S = "${WORKDIR}"

RDEPENDS:${PN} = "plymouth"

do_install() {
    # ── Firmware-level splash (shown before kernel takes over) ──────────
    # Pi firmware reads /boot/splash.jpeg when splash= is set in config.txt
    install -d ${D}/boot
    install -m 0644 ${WORKDIR}/boot-dark.jpeg ${D}/boot/splash.jpeg

    # ── Plymouth theme (shown once kernel + initramfs are running) ──────
    # cyberdeck.script references Image("boot.jpeg") — must live in ImageDir
    THEME_DIR=${D}/usr/share/plymouth/themes/cyberdeck
    install -d ${THEME_DIR}
    install -m 0644 ${WORKDIR}/boot-dark.jpeg  ${THEME_DIR}/boot.jpeg
    install -m 0644 ${S}/../cyberdeck.plymouth  ${THEME_DIR}/cyberdeck.plymouth
    install -m 0644 ${S}/../cyberdeck.script    ${THEME_DIR}/cyberdeck.script
}

pkg_postinst:${PN}() {
    # Register as the active Plymouth theme
    plymouth-set-default-theme cyberdeck || true
}

FILES:${PN} = "/boot/splash.jpeg \
               /usr/share/plymouth/themes/cyberdeck"
