import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function GET(
  req: Request
) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    const isDirect = searchParams.get("isDirect") === "true";

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!chatId) return new NextResponse("Chat ID Missing", { status: 400 });

    let chatLog = "";

    const clearedChat = await db.clearedChat.findUnique({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId: chatId
        }
      }
    });

    const clearedAt = clearedChat?.clearedAt || new Date(0);

    if (isDirect) {
      const messages = await db.directMessage.findMany({
        where: { 
          conversationId: chatId,
          createdAt: { gt: clearedAt }
        },
        include: { member: { include: { profile: true } } },
        orderBy: { createdAt: "asc" }
      });

      chatLog = messages.map(msg => 
        `[${msg.createdAt.toISOString()}] ${msg.member.profile.name}: ${msg.content || (msg.fileUrl ? "[Media/Attachment]" : "")}`
      ).join("\n");
    } else {
      const messages = await db.message.findMany({
        where: { 
          channelId: chatId,
          createdAt: { gt: clearedAt }
        },
        include: { member: { include: { profile: true } } },
        orderBy: { createdAt: "asc" }
      });

      chatLog = messages.map(msg => 
        `[${msg.createdAt.toISOString()}] ${msg.member.profile.name}: ${msg.content || (msg.fileUrl ? "[Media/Attachment]" : "")}`
      ).join("\n");
    }

    return new NextResponse(chatLog, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="chat_export_${chatId}.txt"`
      }
    });

  } catch (error) {
    console.error("[EXPORT_CHAT_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
