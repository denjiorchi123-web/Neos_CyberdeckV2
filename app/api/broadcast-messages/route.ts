import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

const MESSAGES_BATCH = 10;

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);

    const cursor = searchParams.get("cursor");
    const broadcastId = searchParams.get("broadcastId");

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!broadcastId) return new NextResponse("Broadcast ID missing", { status: 400 });

    let messages = [];

    if (cursor) {
      messages = await db.broadcastMessage.findMany({
        take: MESSAGES_BATCH,
        skip: 1,
        cursor: { id: cursor },
        where: { channelId: broadcastId },
        orderBy: { createdAt: "desc" }
      });
    } else {
      messages = await db.broadcastMessage.findMany({
        take: MESSAGES_BATCH,
        where: { channelId: broadcastId },
        orderBy: { createdAt: "desc" }
      });
    }

    let nextCursor = null;

    if (messages.length === MESSAGES_BATCH) {
      nextCursor = messages[MESSAGES_BATCH - 1].id;
    }

    // We must map the messages to include a spoofed member so `ChatMessages` renders correctly
    const broadcastChannel = await db.broadcastChannel.findUnique({
      where: { id: broadcastId }
    });

    const spoofedMessages = messages.map(msg => ({
      ...msg,
      member: {
        id: "admin",
        role: "ADMIN",
        profile: {
          id: broadcastChannel?.profileId || "",
          name: broadcastChannel?.name || "Announcement",
          imageUrl: broadcastChannel?.imageUrl || ""
        }
      }
    }));

    return NextResponse.json({
      items: spoofedMessages,
      nextCursor
    });
  } catch (error) {
    console.error("[BROADCAST_MESSAGES_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
