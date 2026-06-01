import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { chatId } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!chatId) return new NextResponse("Chat ID Missing", { status: 400 });

    const clearedChat = await db.clearedChat.upsert({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId: chatId,
        }
      },
      update: {
        clearedAt: new Date()
      },
      create: {
        profileId: profile.id,
        chatId: chatId,
        clearedAt: new Date()
      }
    });

    return NextResponse.json(clearedChat);
  } catch (error) {
    console.error("[CLEAR_CHAT_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
