#!/usr/bin/env python3
content = '''# POKY_BBLAYERS_CONF_VERSION is increased each time build/conf/bblayers.conf
# changes incompatibly
POKY_BBLAYERS_CONF_VERSION = "2"

BBPATH = "${TOPDIR}"
BBFILES ?= ""

BBLAYERS ?= " \\
  /home/nova/cyberdeck/sources/poky/meta \\
  /home/nova/cyberdeck/sources/poky/meta-poky \\
  /home/nova/cyberdeck/sources/poky/meta-yocto-bsp \\
  /home/nova/cyberdeck/sources/meta-openembedded/meta-oe \\
  /home/nova/cyberdeck/sources/meta-openembedded/meta-python \\
  /home/nova/cyberdeck/sources/meta-openembedded/meta-networking \\
  /home/nova/cyberdeck/sources/meta-openembedded/meta-filesystems \\
  /home/nova/cyberdeck/sources/meta-openembedded/meta-webserver \\
  /home/nova/cyberdeck/sources/meta-raspberrypi \\
  /home/nova/cyberdeck/sources/meta-security \\
  /home/nova/cyberdeck/sources/meta-virtualization \\
  /home/nova/cyberdeck/sources/meta-cyberdeck \\
  "
'''

with open('/home/nova/cyberdeck/build/conf/bblayers.conf', 'w') as f:
    f.write(content)
print("bblayers.conf written with meta-webserver added")
