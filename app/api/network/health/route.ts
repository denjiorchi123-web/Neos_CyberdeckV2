import { NextResponse } from "next/server";
import os from "os";
import { getLocalIp, getLocalIps, getLocalNodeId, isDirectEthernetReady } from "@/lib/mesh-identity";
import { getNetworkSummary, type MeshLanInterface } from "@/lib/mesh-network";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const network = getNetworkSummary();
    return NextResponse.json({
      ip: getLocalIp(),
      ips: getLocalIps(),
      mac: getLocalNodeId(),
      hostname: os.hostname(),
      ethernetReady: isDirectEthernetReady(),
      selectedInterface: network.selectedInterface,
      lanInterfaces: network.interfaces.map((iface: MeshLanInterface) => ({
        name: iface.name,
        address: iface.address,
        netmask: iface.netmask,
        mac: iface.mac,
      })),
      ethernetMessage: isDirectEthernetReady()
        ? `LAN interface ready${network.selectedInterface ? ` on ${network.selectedInterface}` : ""}`
        : "LAN link not ready - connect a cable or ensure the OS has any active private/link-local IPv4 address on the LAN adapter",
      timestamp: Date.now() / 1000
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch health" }, { status: 500 });
  }
}
