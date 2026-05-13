#!/usr/bin/env python3
path = "/home/nova/cyberdeck/sources/meta-cyberdeck/conf/machine/cyberdeck-pi5.conf"
with open(path, 'r') as f:
    content = f.read()

# Add KBUILD_DEFCONFIG if not present
if 'KBUILD_DEFCONFIG' not in content:
    content += '\nKBUILD_DEFCONFIG = "bcm2712_defconfig"\n'
    with open(path, 'w') as f:
        f.write(content)
    print("KBUILD_DEFCONFIG added")
else:
    print("KBUILD_DEFCONFIG already present")

print("---FINAL CONFIG---")
print(content)
