# =============================================================================
# CyberDeck — Chromium 147 Yocto bbappend
#
# File: deploy/yocto/snippets/chromium-ozone-wayland_147.0.7727.116.bbappend
#
# Deploy target:
#   meta-cyberdeck/recipes-browser/chromium/
#   chromium-ozone-wayland_147.0.7727.116.bbappend
#
# Staged by: deploy/scripts/stage-meta-cyberdeck.sh
#
# Why this file exists:
#   Chromium 147's bundled libc++ requires Clang 20+ builtins.
#   We use meta-clang on the 'scarthgap-clang20' branch which provides
#   Clang 20 natively — no source-level patches needed.
# =============================================================================

# ── Toolchain ──────────────────────────────────────────────────────────────
TOOLCHAIN = "clang"

# ── Compiler flags ─────────────────────────────────────────────────────────
CXXFLAGS:append = " -Wno-error=\#warnings"

# ── Pre-configure check ────────────────────────────────────────────────────
do_configure:prepend() {
    _clang_major=$(${CC} -dM -E - </dev/null 2>/dev/null \
        | awk '/__clang_major__/ {print $3}')
    bbnote "chromium-ozone-wayland: using compiler ${CC}"
    bbnote "chromium-ozone-wayland: Clang major = ${_clang_major:-unknown}"
    if [ "${_clang_major:-0}" -lt 20 ]; then
        bbwarn "chromium-ozone-wayland: Clang ${_clang_major} detected but Clang 20+ is required!"
        bbwarn "Ensure meta-clang is on the 'scarthgap-clang20' branch."
    fi
}
