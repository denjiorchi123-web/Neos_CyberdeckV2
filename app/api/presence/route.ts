import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

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

    return NextResponse.json({ online: users, count: users.length });
  } catch (error) {
    console.error("[Presence API] Error:", error);

    // Graceful fallback when Redis is unavailable
    return NextResponse.json(
      { online: [], count: 0, error: "Redis unavailable" },
      { status: 200 }
    );
  }
}
