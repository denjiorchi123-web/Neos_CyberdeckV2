import { NextResponse } from "next/server";
import os from "os";
import { db } from "@/lib/db";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  try {
    const myHostname = os.hostname();

    // Fetch directly from the Prisma database, ignoring stale peers
    const activeThreshold = new Date(Date.now() - 30 * 1000); // 30 seconds
    const dbPeers = await db.meshPeer.findMany({
      where: {
        lastSeen: { gte: activeThreshold }
      }
    });

    const peers = [];

    for (const peer of dbPeers) {
       // Don't list ourselves as a remote peer
       if (peer.hostname && peer.hostname.toLowerCase() !== myHostname.toLowerCase()) {
          peers.push({
             name: peer.hostname.toUpperCase(),
             host: peer.ipAddress,
             address: peer.ipAddress,
             macAddress: peer.macAddress,
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
