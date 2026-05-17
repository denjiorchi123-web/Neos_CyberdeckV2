import "server-only";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import os from "os";

const execAsync = promisify(exec);

export interface Peer {
  /** Friendly display name (from avahi service name, or static config). */
  name: string;
  /** Hostname or IP literal that the browser should navigate to. */
  host: string;
  /** IP literal if known — useful when mDNS resolution fails on the client. */
  address?: string;
  /** How we learned about this peer. */
  source: "mdns" | "static";
  /** mDNS peers are by definition currently reachable; static peers are presumptive. */
  online: boolean;
}

/**
 * Discover other CyberDeck nodes on the LAN.
 *
 * Strategy:
 *   1. Live scan via `avahi-browse` against the `_cyberdeck._tcp` service.
 *   2. Read static fallback list from CYBERDECK_PEERS_FILE (default /opt/cyberdeck/peers.json).
 *   3. Merge, dedupe by hostname, and filter out this Pi itself.
 *
 * Returns an empty array if nothing is found — never throws. The caller renders
 * "no peers" UI; we don't want a transient avahi hiccup to break the launcher.
 */
export async function discoverPeers(): Promise<Peer[]> {
  const [mdns, staticPeers] = await Promise.all([
    discoverMdnsPeers(),
    loadStaticPeers(),
  ]);
  return mergePeers([...mdns, ...staticPeers]);
}

async function discoverMdnsPeers(): Promise<Peer[]> {
  try {
    // -t terminate after initial cache, -r resolve, -p parsable, -k no DB lookups
    const { stdout } = await execAsync(
      "avahi-browse -t -r -p -k _cyberdeck._tcp",
      { timeout: 3000, maxBuffer: 1024 * 256 },
    );

    const peers: Peer[] = [];
    for (const line of stdout.split("\n")) {
      // Resolved entries start with '='; format:
      //   =;iface;proto;name;type;domain;host;address;port;txt
      if (!line.startsWith("=")) continue;
      const cols = line.split(";");
      const name    = cols[3] ?? "";
      const host    = cols[6] ?? "";
      const address = cols[7] ?? "";

      if (!host && !address) continue;

      peers.push({
        name:    decodeAvahiString(name) || host || address,
        host:    host || address,
        address: address || undefined,
        source:  "mdns",
        online:  true,
      });
    }
    return peers;
  } catch {
    // avahi-browse not installed, no avahi-daemon, or the LAN is empty.
    return [];
  }
}

async function loadStaticPeers(): Promise<Peer[]> {
  const path = process.env.CYBERDECK_PEERS_FILE || "/opt/cyberdeck/peers.json";
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as { peers?: { name?: string; host: string; address?: string }[] };
    if (!Array.isArray(data.peers)) return [];
    return data.peers
      .filter((p) => typeof p.host === "string" && p.host.length > 0)
      .map((p) => ({
        name:    p.name || p.host,
        host:    p.host,
        address: p.address,
        source:  "static" as const,
        online:  false,  // we don't probe — let the user attempt to connect
      }));
  } catch {
    return [];
  }
}

/** avahi -p output escapes `;` `\` and non-printables as `\NNN` octal. */
function decodeAvahiString(s: string): string {
  return s.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function mergePeers(all: Peer[]): Peer[] {
  const myHostname = os.hostname().toLowerCase();
  const myShort    = myHostname.split(".")[0];

  const seen = new Set<string>();
  const result: Peer[] = [];

  for (const p of all) {
    const key = (p.host || p.address || "").toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;

    // Filter ourselves out — match by fully-qualified hostname or shortname.
    const peerHost  = p.host.toLowerCase();
    const peerShort = peerHost.split(".")[0];
    if (peerHost === myHostname || peerShort === myShort) continue;

    seen.add(key);
    result.push(p);
  }

  // mDNS-online entries first, then static.
  result.sort((a, b) => Number(b.online) - Number(a.online));
  return result;
}
