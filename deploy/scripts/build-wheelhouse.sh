#!/bin/bash
# Build an offline pip wheelhouse with fastapi + uvicorn + their deps,
# targeting linux-aarch64 / cpython 3.12. Ships as a tarball that gets extracted
# to /opt/cyberdeck/wheels/ in the image; the firstboot script then runs
# `pip install --no-index --find-links /opt/cyberdeck/wheels fastapi uvicorn`.
set -euo pipefail

META="$HOME/cyberdeck/sources/meta-cyberdeck"
RECIPE_DIR="$META/recipes-cyberdeck/cyberdeck-wheelhouse"
FILES_DIR="$RECIPE_DIR/files"
WHEELS=/tmp/cyberdeck-wheels

mkdir -p "$FILES_DIR" "$WHEELS"
rm -f "$WHEELS"/*.whl 2>/dev/null || true

# Pi 5 runs aarch64 / cpython 3.12 (matches what meta-oe ships).
# --platform manylinux2014_aarch64 covers the common ABI tag for aarch64 wheels.
echo "[1/3] Downloading wheels for linux-aarch64 / py3.12..."
python3 -m pip download \
    --dest "$WHEELS" \
    --only-binary=:all: \
    --platform manylinux2014_aarch64 \
    --platform manylinux_2_17_aarch64 \
    --python-version 312 \
    --implementation cp \
    --abi cp312 \
    fastapi uvicorn 'pydantic>=2' redis 2>&1 | tail -5

# Pure-python deps that don't have wheels under those tags still need to come
# along. Re-run without --platform to grab the source-only ones (typing-extensions etc).
echo "[1b] Adding remaining pure-python deps..."
python3 -m pip download \
    --dest "$WHEELS" \
    --no-deps \
    sniffio anyio idna h11 click 2>&1 | tail -5

ls -lh "$WHEELS"/ | head -20

# Tarball
echo "[2/3] Creating wheelhouse tarball..."
rm -f "$FILES_DIR/cyberdeck-wheelhouse-1.0.tar.gz"
tar -czf "$FILES_DIR/cyberdeck-wheelhouse-1.0.tar.gz" --transform 's,^\./,cyberdeck-wheelhouse-1.0/,' -C "$WHEELS" .
ls -lh "$FILES_DIR/cyberdeck-wheelhouse-1.0.tar.gz"

# Recipe
echo "[3/3] Writing cyberdeck-wheelhouse.bb..."
cat > "$RECIPE_DIR/cyberdeck-wheelhouse.bb" <<'EOF'
SUMMARY  = "Pip wheelhouse for offline fastapi/uvicorn install on the Pi"
LICENSE  = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://cyberdeck-wheelhouse-1.0.tar.gz"
S = "${WORKDIR}/cyberdeck-wheelhouse-1.0"

RDEPENDS:${PN} = "python3-pip"

do_install() {
    install -d ${D}/opt/cyberdeck/wheels
    cp -a ${S}/*.whl ${D}/opt/cyberdeck/wheels/ 2>/dev/null || true
}

FILES:${PN} = "/opt/cyberdeck/wheels"

# Prebuilt wheels — skip arch QA.
INSANE_SKIP:${PN} += "arch installed-vs-shipped"
EOF

echo "[done] wheelhouse staged"
ls -la "$RECIPE_DIR/" "$FILES_DIR/"
