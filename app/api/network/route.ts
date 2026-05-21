import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";

// Cache PowerShell results for 20s — Get-NetAdapter can take 3-8s on Windows
let _cache: { data: NetInterface[]; ts: number } | null = null;
const CACHE_TTL = 20_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface NetInterface {
  name:     string;
  mac?:     string;
  ip?:      string;
  prefix?:  number;
  gateway?: string;
  up:       boolean;
  loopback: boolean;
  dhcp:     boolean; // true = currently using DHCP
}

// ── Windows ───────────────────────────────────────────────────────────────────

function windowsInterfaces(): NetInterface[] {
  try {
    const raw = execSync(
      "powershell -NoProfile -Command \"" +
        "Get-NetAdapter | ForEach-Object {" +
        "  $idx  = $_.InterfaceIndex;" +
        "  $addr = Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue |" +
        "          Where-Object {$_.IPAddress -notlike '169.*'} |" +
        "          Select-Object -First 1;" +
        "  $gw   = Get-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -EA SilentlyContinue |" +
        "          Select-Object -First 1;" +
        "  [PSCustomObject]@{" +
        "    Name    = $_.Name;" +
        "    MAC     = $_.MacAddress;" +
        "    IP      = if($addr){$addr.IPAddress}else{$null};" +
        "    Prefix  = if($addr){[int]$addr.PrefixLength}else{$null};" +
        "    Gateway = if($gw){$gw.NextHop}else{$null};" +
        "    Up      = $_.Status -eq 'Up';" +
        "    DHCP    = if($addr){$addr.PrefixOrigin -eq 'Dhcp'}else{$false}" +
        "  }" +
        "} | ConvertTo-Json -Compress\"",
      { timeout: 10000, encoding: "utf8" }
    );

    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null") return fallbackFromOs();

    let items = JSON.parse(trimmed);
    if (!Array.isArray(items)) items = [items];

    return items
      .filter((d: Record<string, unknown>) => {
        const n = String(d.Name ?? "").toLowerCase();
        return !n.includes("loopback") && !n.includes("wi-fi") && !n.startsWith("wl");
      })
      .map((d: Record<string, unknown>) => ({
        name:     String(d.Name ?? ""),
        mac:      d.MAC     ? String(d.MAC)     : undefined,
        ip:       d.IP      ? String(d.IP)      : undefined,
        prefix:   d.Prefix  != null ? Number(d.Prefix)  : undefined,
        gateway:  d.Gateway ? String(d.Gateway) : undefined,
        up:       d.Up !== false,
        loopback: false,
        dhcp:     d.DHCP === true,
      }));
  } catch {
    return fallbackFromOs();
  }
}

// ── Linux ─────────────────────────────────────────────────────────────────────

interface IpAddrEntry {
  ifname:    string;
  flags?:    string[];
  address?:  string;
  addr_info?: { family: string; local: string; prefixlen: number }[];
}

function linuxDhcpSet(): Set<string> {
  // Check systemd-networkd config files for DHCP=yes entries
  const dhcpIfaces = new Set<string>();
  try {
    const out = execSync(
      "grep -rl 'DHCP=yes\\|DHCP=ipv4' /etc/systemd/network/ 2>/dev/null || true",
      { timeout: 2000, encoding: "utf8", shell: "/bin/sh" }
    );
    for (const file of out.trim().split("\n").filter(Boolean)) {
      const nameMatch = execSync(`grep -oP '(?<=Name=)\\S+' "${file}" 2>/dev/null || true`,
        { timeout: 1000, encoding: "utf8", shell: "/bin/sh" }).trim();
      if (nameMatch) dhcpIfaces.add(nameMatch);
    }
  } catch {}
  // Also check if dhclient is running for any interface
  try {
    const pids = execSync("ls /var/run/dhclient.*.pid 2>/dev/null || true",
      { timeout: 1000, encoding: "utf8", shell: "/bin/sh" }).trim();
    for (const p of pids.split("\n").filter(Boolean)) {
      const m = p.match(/dhclient\.(.+)\.pid/);
      if (m) dhcpIfaces.add(m[1]);
    }
  } catch {}
  return dhcpIfaces;
}

function linuxInterfaces(): NetInterface[] {
  try {
    const raw = execSync("ip -j addr show 2>/dev/null", {
      timeout: 3000, encoding: "utf8", shell: "/bin/sh",
    });
    const entries = JSON.parse(raw) as IpAddrEntry[];

    let gwMap: Record<string, string> = {};
    try {
      const gwRaw = execSync("ip -j route show default 2>/dev/null",
        { timeout: 2000, encoding: "utf8", shell: "/bin/sh" });
      const routes = JSON.parse(gwRaw) as { dev: string; gateway?: string }[];
      for (const r of routes) if (r.gateway && r.dev) gwMap[r.dev] = r.gateway;
    } catch {}

    const dhcpSet = linuxDhcpSet();

    return entries.map(e => {
      const flags    = e.flags ?? [];
      const up       = flags.includes("UP");
      const loopback = flags.includes("LOOPBACK");
      const ipv4     = e.addr_info?.find(a => a.family === "inet");
      return {
        name:     e.ifname,
        mac:      e.address && e.address !== "00:00:00:00:00:00" ? e.address : undefined,
        ip:       ipv4?.local,
        prefix:   ipv4?.prefixlen,
        gateway:  gwMap[e.ifname],
        up,
        loopback,
        dhcp:     dhcpSet.has(e.ifname),
      };
    }).filter(e => {
      const n = e.name.toLowerCase();
      return !n.startsWith("wl") && !n.includes("wi-fi");
    });
  } catch {
    return fallbackFromOs();
  }
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function fallbackFromOs(): NetInterface[] {
  const ifaces = os.networkInterfaces();
  return Object.entries(ifaces).flatMap(([name, addrs]) => {
    if (!addrs) return [];
    const ipv4 = addrs.find(a => a.family === "IPv4");
    return [{
      name,
      mac:      ipv4?.mac,
      ip:       ipv4?.address,
      prefix:   ipv4 ? cidrFromNetmask(ipv4.netmask) : undefined,
      up:       true,
      loopback: ipv4?.internal ?? false,
      dhcp:     false,
    }];
  });
}

function cidrFromNetmask(mask: string): number {
  return mask.split(".").reduce((acc, o) => {
    let n = parseInt(o), bits = 0;
    while (n) { bits += n & 1; n >>= 1; }
    return acc + bits;
  }, 0);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const bust = new URL(req.url).searchParams.has("bust");

  if (!bust && _cache && Date.now() - _cache.ts < CACHE_TTL) {
    const sorted = [..._cache.data].sort((a, b) => {
      if (a.loopback !== b.loopback) return a.loopback ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({ interfaces: sorted, hostname: os.hostname(), cached: true });
  }

  const ifaces = process.platform === "win32" ? windowsInterfaces() : linuxInterfaces();

  const sorted = [...ifaces].sort((a, b) => {
    if (a.loopback !== b.loopback) return a.loopback ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  _cache = { data: ifaces, ts: Date.now() };
  return NextResponse.json({ interfaces: sorted, hostname: os.hostname() });
}
