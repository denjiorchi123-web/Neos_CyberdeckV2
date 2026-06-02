import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLocalNodeId } from "@/lib/mesh-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const activeThreshold = new Date(Date.now() - 30 * 1000);
    const localNodeId = getLocalNodeId();
    const peers = await db.meshPeer.findMany({
      where: {
        lastSeen: { gte: activeThreshold },
        macAddress: {
          not: localNodeId,
        },
      },
    });

    // Convert to dictionary format expected by frontend
    const result: Record<string, any> = {};
    for (const p of peers) {
       if (p.macAddress.startsWith("mock_")) continue;
       result[p.macAddress] = {
          ip: p.ipAddress,
          hostname: p.hostname,
          trust_status: p.status,
          last_seen: Math.floor(p.lastSeen.getTime() / 1000),
          joined_at: Math.floor(p.createdAt.getTime() / 1000)
       };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[NETWORK_PEERS_GET]", error);
    return NextResponse.json({ error: "Failed to fetch peers" }, { status: 500 });
  }
}
