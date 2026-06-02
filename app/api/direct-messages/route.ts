import { NextResponse } from "next/server";
import { DirectMessage } from "@prisma/client";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { publicProfileSelect } from "@/lib/public-profile-select";

const MESSAGES_BATCH = 30;

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);

    const cursor = searchParams.get("cursor");
    const conversationId = searchParams.get("conversationId");

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    if (!conversationId)
      return new NextResponse("Conversation ID Missing", { status: 400 });

    // ── Check if the chat was cleared ─────────────────────────
    const clearedChat = await db.clearedChat.findUnique({
      where: { profileId_chatId: { profileId: profile.id, chatId: conversationId } }
    });
    const clearedAt = clearedChat?.clearedAt || new Date(0);

    // ── Database Query ───────────────────────────────────────
    let messages: DirectMessage[] = [];

    const includeConfig = {
      member: {
        include: { profile: { select: publicProfileSelect } }
      },
      replyTo: {
        include: {
          member: { include: { profile: { select: publicProfileSelect } } }
        }
      }
    };

    if (cursor) {
      messages = await db.directMessage.findMany({
        take: MESSAGES_BATCH,
        skip: 1,
        cursor: {
          id: cursor
        },
        where: {
          conversationId,
          createdAt: { gt: clearedAt }
        },
        include: includeConfig,
        orderBy: { createdAt: "desc" }
      });
    } else {
      messages = await db.directMessage.findMany({
        take: MESSAGES_BATCH,
        where: { 
          conversationId,
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
    console.error("[DIRECT_MESSAGES_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
