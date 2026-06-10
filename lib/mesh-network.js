const os = require("os");
const { execSync } = require("child_process");

const INTERFACE_NAMES = parseCsv(process.env.MESH_INTERFACE_NAMES || process.env.MESH_INTERFACE || "");
const INTERFACE_PREFIXES = parseCsv(process.env.MESH_INTERFACE_PREFIXES || process.env.MESH_DIRECT_PREFIXES || "");
const BROADCAST_ADDRS = parseCsv(process.env.MESH_BROADCAST_ADDRS || process.env.MESH_BROADCAST_ADDR || "");
const FALLBACK_IPS = parseCsv(process.env.MESH_PEER_FALLBACK_IPS || "");
const ALLOW_PUBLIC_LAN = process.env.MESH_ALLOW_PUBLIC_LAN === "1";
const DIRECT_PROBES_ENABLED =
  process.env.MESH_DIRECT_PROBES !== "0" && process.env.MESH_SUBNET_PROBES !== "0";
const NEIGHBOR_PROBES_ENABLED = process.env.MESH_NEIGHBOR_PROBES !== "0";
const SUBNET_PROBE_LIMIT = positiveInt(process.env.MESH_SUBNET_PROBE_LIMIT, 256);
const DIRECT_PROBE_LIMIT = positiveInt(process.env.MESH_DIRECT_PROBE_LIMIT, 512);
const NEIGHBOR_CACHE_TTL_MS = positiveInt(process.env.MESH_NEIGHBOR_CACHE_TTL_MS, 10_000);
const STRICT_INTERFACE_FILTER =
  process.env.MESH_INTERFACE_STRICT === "1" || process.env.MESH_DISCOVERY_STRICT === "1";
const COMMON_DIRECT_HOSTS = [1, 2, 3, 4, 5, 10, 20, 50, 99, 100, 101, 200, 254];
let neighborCache = { ts: 0, ips: [] };

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeIp(ip) {
  return typeof ip === "string" && ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isUsableIPv4(ip) {
  if (typeof ip !== "string") return false;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (ip === "0.0.0.0" || ip === "255.255.255.255") return false;
  if (parts[0] === 127) return false;
  return true;
}

function isPrivateOrLinkLocalIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function matchesConfiguredPrefix(ip) {
  return INTERFACE_PREFIXES.length > 0 && INTERFACE_PREFIXES.some((prefix) => ip.startsWith(prefix));
}

function matchesConfiguredName(name) {
  if (name === "lo") return true;
  if (INTERFACE_NAMES.length === 0) return true;
  return INTERFACE_NAMES.some((configured) => name.toLowerCase().includes(configured.toLowerCase()));
}

function normalizeFallbackIp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(`mesh://${raw}`).hostname;
  } catch {
    return raw.split(":")[0];
  }
}

function interfaceScore(name, iface) {
  const lowerName = name.toLowerCase();
  let score = 0;
  if (INTERFACE_NAMES.length > 0 && matchesConfiguredName(name)) score += 1000;
  if (matchesConfiguredPrefix(iface.address)) score += 700;
  if (isPrivateOrLinkLocalIPv4(iface.address)) score += 250;
  if (iface.address.startsWith("169.254.")) score += 60;
  if (/(^|[\s_-])(eth|enp|ens|eno|enx|ethernet|lan|usb)([\s_-]|$|\d)/i.test(name)) score += 150;
  if (/(wi-fi|wifi|wlan|wireless)/i.test(name)) score += 40;
  if (/(virtual|vbox|vmware|hyper-v|vethernet|docker|tailscale|zerotier|loopback)/i.test(name)) score -= 300;
  if (isVirtualMac(iface.mac)) score -= 500;
  if (iface.address.endsWith(".1")) score -= 30;
  if (iface.mac && iface.mac !== "00:00:00:00:00:00") score += 20;
  return score;
}

function isVirtualMac(mac) {
  const compact = String(mac || "").toLowerCase().replace(/[:-]/g, "");
  return (
    compact.startsWith("080027") ||
    compact.startsWith("0a0027") ||
    compact.startsWith("000569") ||
    compact.startsWith("000c29") ||
    compact.startsWith("001c14") ||
    compact.startsWith("005056") ||
    compact.startsWith("00155d") ||
    compact.startsWith("0242")
  );
}

function getAllIPv4Interfaces() {
  const result = [];
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family !== "IPv4" || !isUsableIPv4(iface.address)) continue;
      result.push({
        name,
        address: iface.address,
        netmask: iface.netmask,
        mac: iface.mac,
        cidr: iface.cidr,
        score: interfaceScore(name, iface),
      });
    }
  }
  return result;
}

function getLanInterfaces() {
  const all = getAllIPv4Interfaces();
  let usable = all.filter((iface) => matchesConfiguredName(iface.name));
  if (STRICT_INTERFACE_FILTER && INTERFACE_PREFIXES.length > 0) {
    const prefixMatches = usable.filter((iface) => matchesConfiguredPrefix(iface.address));
    if (prefixMatches.length > 0) usable = prefixMatches;
  }

  const lan = usable.filter((iface) => ALLOW_PUBLIC_LAN || isPrivateOrLinkLocalIPv4(iface.address) || matchesConfiguredPrefix(iface.address));
  return (lan.length > 0 ? lan : usable).sort((a, b) => b.score - a.score);
}

function getPreferredLanInterface() {
  return getLanInterfaces()[0] || null;
}

function getLocalIps() {
  return getAllIPv4Interfaces().map((iface) => iface.address);
}

function getLanIps() {
  return getLanInterfaces().map((iface) => iface.address);
}

function getPreferredLanIp() {
  return getPreferredLanInterface()?.address || getLocalIps()[0] || "127.0.0.1";
}

function getPreferredLanMac() {
  const iface = getPreferredLanInterface();
  return iface?.mac && iface.mac !== "00:00:00:00:00:00" ? iface.mac.replace(/:/g, "").toLowerCase() : "";
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}

function intToIPv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function cidrFromNetmask(netmask) {
  if (!isUsableIPv4(netmask)) return null;
  const mask = ipv4ToInt(netmask);
  let bits = 0;
  for (let i = 31; i >= 0; i -= 1) {
    if (((mask >>> i) & 1) === 1) bits += 1;
    else break;
  }
  return bits;
}

function broadcastFor(address, netmask) {
  if (!isUsableIPv4(address) || !isUsableIPv4(netmask)) return null;
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  return intToIPv4((ip | (~mask >>> 0)) >>> 0);
}

function getBroadcastAddresses() {
  const addresses = new Set(BROADCAST_ADDRS);
  for (const iface of getLanInterfaces()) {
    const broadcast = broadcastFor(iface.address, iface.netmask);
    if (broadcast && broadcast !== iface.address) addresses.add(broadcast);
  }
  return [...addresses];
}

function getConfiguredFallbackIps() {
  return FALLBACK_IPS.map(normalizeFallbackIp).filter((ip) => isUsableIPv4(ip));
}

function addProbeIp(targets, value, iface, localIpSet) {
  const ip = normalizeIp(value);
  if (!isUsableIPv4(ip) || (localIpSet ? localIpSet.has(ip) : isLocalIp(ip))) return;
  if (iface) {
    if (!isIpInInterfaceSubnet(ip, iface)) return;
    if (ip === broadcastFor(iface.address, iface.netmask)) return;
  }
  targets.add(ip);
}

function isIpInInterfaceSubnet(ip, iface) {
  if (!isUsableIPv4(ip)) return false;
  if (!iface || !isUsableIPv4(iface.address) || !isUsableIPv4(iface.netmask)) return true;
  const mask = ipv4ToInt(iface.netmask);
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(iface.address) & mask);
}

function probeAddressesForInterface(iface, localIpSet) {
  if (!DIRECT_PROBES_ENABLED || !isUsableIPv4(iface.address) || !isUsableIPv4(iface.netmask)) return [];

  const targets = new Set();
  const ip = ipv4ToInt(iface.address);
  const mask = ipv4ToInt(iface.netmask);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hostCount = broadcast > network ? broadcast - network - 1 : 0;

  if (hostCount > 0 && hostCount <= SUBNET_PROBE_LIMIT) {
    for (let host = network + 1; host < broadcast; host += 1) {
      addProbeIp(targets, intToIPv4(host), iface, localIpSet);
    }
    return [...targets];
  }

  const radius = Math.max(8, Math.floor(SUBNET_PROBE_LIMIT / 4));
  for (let delta = 1; delta <= radius; delta += 1) {
    if (ip - delta > network) addProbeIp(targets, intToIPv4(ip - delta), iface, localIpSet);
    if (ip + delta < broadcast) addProbeIp(targets, intToIPv4(ip + delta), iface, localIpSet);
  }

  const same24Base = ip & 0xffffff00;
  for (const lastOctet of COMMON_DIRECT_HOSTS) {
    addProbeIp(targets, intToIPv4((same24Base | lastOctet) >>> 0), iface, localIpSet);
  }

  const localLastOctet = ip & 255;
  if (localLastOctet === 1) addProbeIp(targets, intToIPv4((same24Base | 2) >>> 0), iface, localIpSet);
  if (localLastOctet === 2) addProbeIp(targets, intToIPv4((same24Base | 1) >>> 0), iface, localIpSet);

  const prefix = cidrFromNetmask(iface.netmask);
  if (prefix != null && prefix <= 16 && iface.address.startsWith("169.254.")) {
    const thirdOctet = (ip >>> 8) & 255;
    for (const nearbyThird of [thirdOctet - 1, thirdOctet + 1, 1, 2, 10, 20, 100, 200, 254]) {
      if (nearbyThird < 1 || nearbyThird > 254) continue;
      for (const lastOctet of [1, 2, 10, 100, 200, 254]) {
        addProbeIp(targets, `169.254.${nearbyThird}.${lastOctet}`, iface, localIpSet);
      }
    }
  }

  return [...targets].slice(0, SUBNET_PROBE_LIMIT);
}

function parseIpsFromText(text, localIpSet) {
  const matches = String(text || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return matches
    .map(normalizeIp)
    .filter((ip) => isUsableIPv4(ip) && !(localIpSet ? localIpSet.has(ip) : isLocalIp(ip)));
}

function readNeighborCacheIps(localIpSet) {
  if (!NEIGHBOR_PROBES_ENABLED) return [];
  const now = Date.now();
  if (now - neighborCache.ts < NEIGHBOR_CACHE_TTL_MS) return neighborCache.ips;

  const ips = new Set();
  const commands = process.platform === "win32"
    ? ["arp -a"]
    : [
        "ip -4 neigh show 2>/dev/null || true",
        "arp -n 2>/dev/null || true",
        "cat /proc/net/arp 2>/dev/null || true",
      ];

  for (const command of commands) {
    try {
      for (const ip of parseIpsFromText(execSync(command, { timeout: 1500, encoding: "utf8" }), localIpSet)) {
        ips.add(ip);
      }
    } catch {}
  }

  neighborCache = { ts: now, ips: [...ips].filter((ip) => ALLOW_PUBLIC_LAN || isPrivateOrLinkLocalIPv4(ip)) };
  return neighborCache.ips;
}

function getDirectProbeAddresses() {
  const targets = new Set();
  const interfaces = getLanInterfaces();
  const localIpSet = new Set(getLocalIps());

  for (const ip of readNeighborCacheIps(localIpSet)) {
    const iface = interfaces.find((item) => isIpInInterfaceSubnet(ip, item));
    if (interfaces.length === 0 || iface) {
      addProbeIp(targets, ip, iface, localIpSet);
    }
  }

  for (const iface of interfaces) {
    for (const ip of probeAddressesForInterface(iface, localIpSet)) {
      addProbeIp(targets, ip, iface, localIpSet);
    }
  }

  return [...targets].slice(0, DIRECT_PROBE_LIMIT);
}

function isLocalIp(ip) {
  const normalized = normalizeIp(ip);
  return getLocalIps().includes(normalized);
}

function isLanReady() {
  return getLanInterfaces().length > 0;
}

function getNetworkSummary() {
  const interfaces = getLanInterfaces();
  return {
    ready: interfaces.length > 0,
    selectedIp: interfaces[0]?.address || getPreferredLanIp(),
    selectedInterface: interfaces[0]?.name || null,
    interfaces,
  };
}

module.exports = {
  broadcastFor,
  getDirectProbeAddresses,
  getBroadcastAddresses,
  getConfiguredFallbackIps,
  getLanInterfaces,
  getLanIps,
  getLocalIps,
  getNetworkSummary,
  getPreferredLanIp,
  getPreferredLanMac,
  isIpInInterfaceSubnet,
  isLanReady,
  isLocalIp,
  isPrivateOrLinkLocalIPv4,
  normalizeIp,
};
