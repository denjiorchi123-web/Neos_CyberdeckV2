const os = require("os");

const INTERFACE_NAMES = parseCsv(process.env.MESH_INTERFACE_NAMES || process.env.MESH_INTERFACE || "");
const INTERFACE_PREFIXES = parseCsv(process.env.MESH_INTERFACE_PREFIXES || process.env.MESH_DIRECT_PREFIXES || "");
const BROADCAST_ADDRS = parseCsv(process.env.MESH_BROADCAST_ADDRS || process.env.MESH_BROADCAST_ADDR || "");
const FALLBACK_IPS = parseCsv(process.env.MESH_PEER_FALLBACK_IPS || "");
const ALLOW_PUBLIC_LAN = process.env.MESH_ALLOW_PUBLIC_LAN === "1";

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  if (INTERFACE_NAMES.length === 0) return true;
  const lowerName = name.toLowerCase();
  return INTERFACE_NAMES.some((configured) => lowerName.includes(configured.toLowerCase()));
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
      if (iface.internal || iface.family !== "IPv4" || !isUsableIPv4(iface.address)) continue;
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
  if (INTERFACE_PREFIXES.length > 0) {
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
  return FALLBACK_IPS.filter((ip) => isUsableIPv4(ip));
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
  getBroadcastAddresses,
  getConfiguredFallbackIps,
  getLanInterfaces,
  getLanIps,
  getLocalIps,
  getNetworkSummary,
  getPreferredLanIp,
  getPreferredLanMac,
  isLanReady,
  isLocalIp,
  isPrivateOrLinkLocalIPv4,
  normalizeIp,
};
