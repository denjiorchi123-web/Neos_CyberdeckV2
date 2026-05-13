#!/usr/bin/env python3
path = "/home/nova/cyberdeck/sources/meta-cyberdeck/conf/machine/cyberdeck-pi5.conf"
with open(path, 'r') as f:
    content = f.read()

# Add KMACHINE after the require line if not already present
if 'KMACHINE' not in content:
    content = content.replace(
        'require conf/machine/raspberrypi5.conf',
        'require conf/machine/raspberrypi5.conf\nKMACHINE = "raspberrypi5"'
    )
    with open(path, 'w') as f:
        f.write(content)
    print("KMACHINE added")
else:
    print("KMACHINE already present")

print("---")
print(content)
