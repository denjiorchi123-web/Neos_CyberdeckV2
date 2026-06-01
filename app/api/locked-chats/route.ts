import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const lockedChats = await db.lockedChat.findMany({
      where: { profileId: profile.id },
      select: { chatId: true }
    });

    const chatIds = lockedChats.map(lc => lc.chatId);
    return NextResponse.json(chatIds);
  } catch (error) {
    console.error("[LOCKED_CHATS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { chatId } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!chatId) return new NextResponse("Chat ID Missing", { status: 400 });
    
    // Check live database for pinHash to avoid Redis cache stale data issues
    const liveProfile = await db.profile.findUnique({ where: { id: profile.id } });
    if (!liveProfile?.pinHash) return new NextResponse("PIN not setup", { status: 400 });

    const lockedChat = await db.lockedChat.upsert({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId,
        }
      },
      update: {},
      create: {
        profileId: profile.id,
        chatId,
      }
    });

    return NextResponse.json(lockedChat);
  } catch (error) {
    console.error("[LOCKED_CHATS_POST]", error);
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

    await db.lockedChat.delete({
      where: {
        profileId_chatId: {
          profileId: profile.id,
          chatId,
        }
      }
    });

    return new NextResponse("Unlocked", { status: 200 });
  } catch (error) {
    console.error("[LOCKED_CHATS_DELETE]", error);
    // Ignore error if it doesn't exist
    return new NextResponse("Unlocked", { status: 200 });
  }
}
