import { NextResponse } from "next/server";
import os from "os";
import { db } from "@/lib/db";
import { getLocalNodeId, isDirectEthernetReady } from "@/lib/mesh-identity";
import { currentProfile } from "@/lib/current-profile";
import { findProfileChatServer } from "@/lib/profile-workspace";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  try {
    const myHostname = os.hostname();
    const localNodeId = getLocalNodeId();
    const profile = await currentProfile();

    // Fetch directly from the Prisma database, ignoring stale peers
    const activeThreshold = new Date(Date.now() - 30 * 1000); // 30 seconds
    const dbPeers = await db.meshPeer.findMany({
      where: {
        lastSeen: { gte: activeThreshold },
        status: { not: "BLOCKED" },
      }
    });

    const connectedUserIds = new Set<string>();
    const connectedNames = new Set<string>();
    const pendingByNode = new Map<string, "PENDING_INCOMING" | "PENDING_OUTGOING">();

    if (profile) {
      const chatServer = await findProfileChatServer(profile.id);
      if (chatServer) {
        const contacts = await db.member.findMany({
          where: { serverId: chatServer.id, profileId: { not: profile.id } },
          include: { profile: true },
        });
        for (const contact of contacts) {
          connectedUserIds.add(contact.profile.userId);
          connectedNames.add(contact.profile.name);
        }
      }

      const pendingRequests = await db.connectionRequest.findMany({
        where: { status: "PENDING", expiresAt: { gte: new Date() } },
      });
      if (pendingRequests.length) {
        const requestById = new Map(pendingRequests.map((request) => [request.requestId, request]));
        const ownerEvents = await db.meshEvent.findMany({
          where: {
            entityType: "connection_request",
            entityId: { in: pendingRequests.map((request) => request.requestId) },
            operation: { in: ["handshake_request_received", "handshake_request_sent"] },
          },
          orderBy: { timestamp: "desc" },
        });
        for (const event of ownerEvents) {
          const request = requestById.get(event.entityId);
          if (!request) continue;
          try {
            const payload = JSON.parse(event.payloadJson);
            if (request.direction === "INCOMING" && payload.targetProfileId === profile.id) {
              pendingByNode.set(request.fromNodeId, "PENDING_INCOMING");
            } else if (request.direction === "OUTGOING" && payload.localProfileId === profile.id) {
              pendingByNode.set(request.toNodeId, "PENDING_OUTGOING");
            }
          } catch {}
        }
      }
    }

    const latestByIdentity = new Map<string, (typeof dbPeers)[number]>();
    for (const peer of dbPeers) {
      if (peer.macAddress === localNodeId || peer.macAddress.startsWith("mock_")) continue;
      const identityKey = peer.userId || peer.publicName || peer.displayName || peer.macAddress;
      const current = latestByIdentity.get(identityKey);
      if (!current || peer.lastSeen > current.lastSeen) {
        latestByIdentity.set(identityKey, peer);
      }
    }

    const peers = [];

    for (const peer of latestByIdentity.values()) {
       const isConnected = connectedUserIds.has(peer.userId || "") ||
         connectedNames.has(peer.publicName || "") ||
         connectedNames.has(peer.displayName || "");
       const trustStatus = isConnected
         ? "TRUSTED"
         : (pendingByNode.get(peer.macAddress) || "UNKNOWN");
       // Two Pis may intentionally share a hostname. The hardware node ID is the identity.
       peers.push({
          name: peer.displayName || peer.publicName || "Unknown peer",
          deviceName: peer.hostname,
          host: peer.ipAddress,
          address: peer.ipAddress,
          macAddress: peer.macAddress,
          userId: peer.userId,
          trustStatus,
          source: "mdns", // Kept as mdns for UI styling
          online: true
       });
    }

    return NextResponse.json({
      self: {
        hostname: myHostname,
      },
      peers,
      lanReady: isDirectEthernetReady(),
    });
  } catch (error) {
     return NextResponse.json({ self: { hostname: os.hostname() }, peers: [], lanReady: false });
  }
}
