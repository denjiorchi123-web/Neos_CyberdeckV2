import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/presence
 * Returns all currently online users from Redis.
 * Each entry has userId + details (socketId, nodeIp, lastSeen).
 */
export async function GET() {
  try {
    // Get all online user IDs
    const onlineUserIds = (await redis.smembers("presence:online")) ?? [];

    // Fetch details for each user
    const users = await Promise.all(
      onlineUserIds.map(async (userId) => {
        const details = await redis.hgetall(`presence:user:${userId}`);
        return {
          userId,
          socketId: details?.socketId || null,
          nodeIp: details?.nodeIp || null,
          lastSeen: details?.lastSeen
            ? parseInt(details.lastSeen, 10)
            : null,
          status: "online" as const,
        };
      })
    );

    const activeThreshold = new Date(Date.now() - 15 * 1000);
    const meshPeers = await db.meshPeer.findMany({
      where: {
        status: { in: ["TRUSTED", "ACCEPTED"] },
        publicName: { not: null },
        lastSeen: { gte: activeThreshold },
      },
    });

    const meshProfiles = await db.profile.findMany({
      where: {
        OR: [
          { id: { in: meshPeers.map((peer) => peer.userId).filter(Boolean) as string[] } },
          { name: { in: meshPeers.map((peer) => peer.publicName!).filter(Boolean) } },
        ],
      },
      select: { id: true, name: true },
    });

    const profileByName = new Map(meshProfiles.map((profile) => [profile.name, profile]));
    const profileById = new Map(meshProfiles.map((profile) => [profile.id, profile]));
    const mergedById = new Map(users.map((user) => [user.userId, user]));

    for (const peer of meshPeers) {
      const profile = (peer.userId ? profileById.get(peer.userId) : null) ||
        (peer.publicName ? profileByName.get(peer.publicName) : null);
      if (!profile) continue;
      mergedById.set(profile.id, {
        userId: profile.id,
        socketId: null,
        nodeIp: peer.ipAddress,
        lastSeen: peer.lastSeen.getTime(),
        status: "online" as const,
      });
    }

    const online = Array.from(mergedById.values());
    return NextResponse.json({ online, count: online.length });
  } catch (error) {
    console.error("[Presence API] Error:", error);

    // Graceful fallback when Redis is unavailable
    return NextResponse.json(
      { online: [], count: 0, error: "Redis unavailable" },
      { status: 200 }
    );
  }
}
