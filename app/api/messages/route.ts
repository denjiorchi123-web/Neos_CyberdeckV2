import { NextResponse } from "next/server";
import { Message } from "@prisma/client";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

const MESSAGES_BATCH = 30;

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);

    const cursor = searchParams.get("cursor");
    const channelId = searchParams.get("channelId");

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    if (!channelId)
      return new NextResponse("Channel ID Missing", { status: 400 });

    const redisKey = `cache:chat:${channelId}:messages`;

    // ── Redis Cache Hit (Initial Load Only) ──────────────────
    if (!cursor) {
      try {
        const cachedMessages = await redis.lrange(redisKey, 0, MESSAGES_BATCH - 1);
        if (cachedMessages.length > 0) {
          const items = cachedMessages.map(m => JSON.parse(m));
          let nextCursor = null;
          if (items.length === MESSAGES_BATCH) {
            nextCursor = items[items.length - 1].id;
          }
          return NextResponse.json({ 
            items, 
            nextCursor, 
            source: "redis" 
          });
        }
      } catch (redisErr) {
        console.error("[Redis Cache GET Error]", redisErr);
      }
    }

    // ── Database Fallback ────────────────────────────────────
    let messages: Message[] = [];

    if (cursor) {
      messages = await db.message.findMany({
        take: MESSAGES_BATCH,
        skip: 1,
        cursor: {
          id: cursor
        },
        where: {
          channelId
        },
        include: {
          member: {
            include: {
              profile: true
            }
          }
        },
        orderBy: { createdAt: "desc" }
      });
    } else {
      messages = await db.message.findMany({
        take: MESSAGES_BATCH,
        where: { channelId },
        include: {
          member: {
            include: {
              profile: true
            }
          }
        },
        orderBy: { createdAt: "desc" }
      });
    }

    let nextCursor = null;

    if (messages.length === MESSAGES_BATCH) {
      nextCursor = messages[MESSAGES_BATCH - 1].id;
    }

    return NextResponse.json({ items: messages, nextCursor, source: "database" });
  } catch (error) {
    console.error("[MESSAGES_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
