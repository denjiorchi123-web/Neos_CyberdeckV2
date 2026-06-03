import { NextResponse } from "next/server";
import os from "os";
import { db } from "@/lib/db";
import { getLocalNodeId } from "@/lib/mesh-identity";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  try {
    const myHostname = os.hostname();
    const localNodeId = getLocalNodeId();

    // Fetch directly from the Prisma database, ignoring stale peers
    const activeThreshold = new Date(Date.now() - 30 * 1000); // 30 seconds
    const dbPeers = await db.meshPeer.findMany({
      where: {
        lastSeen: { gte: activeThreshold },
        status: { notIn: ["BLOCKED", "DECLINED"] },
      }
    });

    const peers = [];

    for (const peer of dbPeers) {
       // Two Pis may intentionally share a hostname. The hardware node ID is the identity.
       if (peer.macAddress !== localNodeId && !peer.macAddress.startsWith("mock_")) {
          peers.push({
             name: peer.displayName || peer.publicName || "Unknown peer",
             deviceName: peer.hostname,
             host: peer.ipAddress,
             address: peer.ipAddress,
             macAddress: peer.macAddress,
             userId: peer.userId,
             trustStatus: peer.status,
             source: "mdns", // Kept as mdns for UI styling
             online: true
          });
       }
    }

    return NextResponse.json({
      self: {
        hostname: myHostname,
      },
      peers,
    });
  } catch (error) {
     return NextResponse.json({ self: { hostname: os.hostname() }, peers: [] });
  }
}
