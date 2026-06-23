import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);

    const chatId = searchParams.get("chatId");
    const isDirect = searchParams.get("isDirect") === "true";
    const limit = parseInt(searchParams.get("limit") || "50");

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!chatId) return new NextResponse("Chat ID missing", { status: 400 });

    const clearedChat = await db.clearedChat.findUnique({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId: chatId
        }
      }
    });

    const clearedAt = clearedChat?.clearedAt || new Date(0);

    let messages = [];

    if (isDirect) {
      const conversation = await db.conversation.findFirst({
        where: {
          id: chatId,
          OR: [
            { memberOne: { profileId: profile.id } },
            { memberTwo: { profileId: profile.id } },
          ],
        },
        select: { id: true },
      });
      if (!conversation) return new NextResponse("Not Found", { status: 404 });

      messages = await db.directMessage.findMany({
        where: {
          conversationId: chatId,
          deleted: false,
          createdAt: { gt: clearedAt },
          OR: [
            { fileUrl: { not: null } },
            { content: { contains: "http" } }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          member: {
            include: { profile: true }
          }
        }
      });
    } else {
      const channel = await db.channel.findFirst({
        where: {
          id: chatId,
          server: { members: { some: { profileId: profile.id } } },
        },
        select: { id: true },
      });
      if (!channel) return new NextResponse("Not Found", { status: 404 });

      messages = await db.message.findMany({
        where: {
          channelId: chatId,
          deleted: false,
          createdAt: { gt: clearedAt },
          OR: [
            { fileUrl: { not: null } },
            { content: { contains: "http" } }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          member: {
            include: { profile: true }
          }
        }
      });
    }

    return NextResponse.json(messages);
  } catch (error) {
    console.error("[CHAT_MEDIA_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
