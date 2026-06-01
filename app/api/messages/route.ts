import { NextResponse } from "next/server";
import { Message } from "@prisma/client";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

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

    // ── Check if the chat was cleared ─────────────────────────
    const clearedChat = await db.clearedChat.findUnique({
      where: { profileId_chatId: { profileId: profile.id, chatId: channelId } }
    });
    const clearedAt = clearedChat?.clearedAt || new Date(0);

    // ── Database Query ───────────────────────────────────────
    let messages: Message[] = [];

    const includeConfig = {
      member: {
        include: { profile: true }
      },
      replyTo: {
        include: {
          member: { include: { profile: true } }
        }
      }
    };

    if (cursor) {
      messages = await db.message.findMany({
        take: MESSAGES_BATCH,
        skip: 1,
        cursor: {
          id: cursor
        },
        where: {
          channelId,
          createdAt: { gt: clearedAt }
        },
        include: includeConfig,
        orderBy: { createdAt: "desc" }
      });
    } else {
      messages = await db.message.findMany({
        take: MESSAGES_BATCH,
        where: { 
          channelId,
          createdAt: { gt: clearedAt }
        },
        include: includeConfig,
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
