import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { chatId, durationHours } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!chatId) return new NextResponse("Chat ID Missing", { status: 400 });

    let expiresAt: Date | null = null;
    if (durationHours && durationHours > 0) {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + durationHours);
    } // else it is muted forever (null)

    const mutedChat = await db.mutedChat.upsert({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId: chatId,
        }
      },
      update: {
        expiresAt: expiresAt
      },
      create: {
        profileId: profile.id,
        chatId: chatId,
        expiresAt: expiresAt
      }
    });

    return NextResponse.json(mutedChat);
  } catch (error) {
    console.error("[MUTE_CHAT_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!chatId) return new NextResponse("Chat ID Missing", { status: 400 });

    await db.mutedChat.delete({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId: chatId,
        }
      }
    });

    return new NextResponse("Unmuted", { status: 200 });
  } catch (error) {
    console.error("[MUTE_CHAT_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
