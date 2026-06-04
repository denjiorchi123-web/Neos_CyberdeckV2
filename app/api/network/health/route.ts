import { NextResponse } from "next/server";
import os from "os";
import { getLocalIp, getLocalIps, getLocalNodeId, isDirectEthernetReady } from "@/lib/mesh-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      ip: getLocalIp(),
      ips: getLocalIps(),
      mac: getLocalNodeId(),
      hostname: os.hostname(),
      ethernetReady: isDirectEthernetReady(),
      ethernetMessage: isDirectEthernetReady()
        ? "Direct Ethernet link ready"
        : "Ethernet link not ready - set static IP 10.0.0.1/24 on Pi and 10.0.0.100/24 on laptop, or use 192.168.10.1/24 and 192.168.10.2/24",
      timestamp: Date.now() / 1000
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch health" }, { status: 500 });
  }
}
